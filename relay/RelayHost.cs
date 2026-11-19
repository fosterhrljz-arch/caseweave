using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace CaseWeave {
    public sealed class RelayHost : IDisposable {
        public const string Origin = "http://127.0.0.1:4179";
        const string Cookie = "CaseWeaveRelay";
        const int RequestLimit = 768 * 1024;
        const int ResponseLimit = 2 * 1024 * 1024;
        readonly HttpListener server = new HttpListener();
        readonly HttpClient upstream = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(75) };
        readonly SemaphoreSlim sendSlot = new SemaphoreSlim(1, 1);
        readonly ConcurrentDictionary<string, DateTime> launches = new ConcurrentDictionary<string, DateTime>();
        readonly string session = Secret();
        readonly byte[] workspace;
        readonly string csp;
        volatile Provider provider;

        sealed class Provider {
            public Uri Endpoint;
            public string Model, Key, Revision;
        }

        public RelayHost(string path) {
            var html = File.ReadAllText(path, Encoding.UTF8);
            workspace = Encoding.UTF8.GetBytes(html);
            var script = Regex.Match(html, @"<script\b[^>]*>([\s\S]*?)</script>", RegexOptions.IgnoreCase);
            if (!script.Success) throw new InvalidDataException("CaseWeave bundle has no inline script.");
            using (var sha = SHA256.Create()) {
                // HTML normalizes CR/LF inside script text before evaluating it.
                var content = script.Groups[1].Value.Replace("\r\n", "\n").Replace("\r", "\n");
                var hash = Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(content)));
                csp = "default-src 'none'; script-src 'sha256-" + hash + "' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; " +
                    "img-src 'self' blob: data:; font-src 'self' blob: data:; worker-src blob:; connect-src 'self' blob: data: https: http://127.0.0.1:* http://localhost:*; " +
                    "base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
            }
            server.Prefixes.Add(Origin + "/");
            server.TimeoutManager.EntityBody = TimeSpan.FromSeconds(12);
            server.Start();
            Task.Run((Func<Task>)Listen);
        }

        public void SetProvider(string address, string model, string key) {
            Uri uri;
            if (!Uri.TryCreate(address.Trim(), UriKind.Absolute, out uri) ||
                (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)) ||
                !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment) ||
                (uri.IsLoopback && uri.Port == 4179)) throw new ArgumentException("endpoint");
            if (String.IsNullOrWhiteSpace(model) || model.Length > 200) throw new ArgumentException("model");
            if (key.IndexOfAny(new[] { '\r', '\n' }) >= 0 || key.Length > 4096) throw new ArgumentException("key");
            var basePath = uri.AbsoluteUri.TrimEnd('/');
            var endpoint = basePath.EndsWith("/chat/completions", StringComparison.Ordinal) ? basePath : basePath + "/chat/completions";
            provider = new Provider { Endpoint = new Uri(endpoint), Model = model.Trim(), Key = key.Trim(), Revision = Secret() };
        }

        public void ClearProvider() { provider = null; }

        public string CreateLaunchLink() {
            foreach (var item in launches) {
                DateTime ignored;
                if (item.Value < DateTime.UtcNow) launches.TryRemove(item.Key, out ignored);
            }
            var ticket = Secret();
            launches[ticket] = DateTime.UtcNow.AddMinutes(2);
            return Origin + "/launch/" + ticket;
        }

        static string Secret() {
            var bytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        static bool Matches(string actual, string expected) {
            if (actual == null || actual.Length != expected.Length) return false;
            var diff = 0;
            for (int i = 0; i < actual.Length; i++) diff |= actual[i] ^ expected[i];
            return diff == 0;
        }

        async Task Listen() {
            while (server.IsListening) {
                HttpListenerContext context;
                try { context = await server.GetContextAsync(); }
                catch (HttpListenerException) { return; }
                catch (ObjectDisposedException) { return; }
                Dispatch(context);
            }
        }

        async void Dispatch(HttpListenerContext context) {
            var request = context.Request;
            var response = context.Response;
            try {
                response.Headers.Add("Cache-Control", "no-store");
                response.Headers.Add("X-Content-Type-Options", "nosniff");
                response.Headers.Add("Referrer-Policy", "no-referrer");
                response.Headers.Add("X-Frame-Options", "DENY");
                response.Headers.Add("Content-Security-Policy", csp);
                if (!request.IsLocal || !String.Equals(request.Headers["Host"], "127.0.0.1:4179", StringComparison.Ordinal)) { response.StatusCode = 403; return; }
                var path = request.Url.AbsolutePath;
                var method = request.HttpMethod;
                if (method == "GET" && path.StartsWith("/launch/", StringComparison.Ordinal)) {
                    DateTime expiry;
                    if (!launches.TryRemove(path.Substring(8), out expiry) || expiry < DateTime.UtcNow) { response.StatusCode = 403; return; }
                    response.Headers.Add("Set-Cookie", Cookie + "=" + session + "; Path=/; HttpOnly; SameSite=Strict");
                    response.StatusCode = 303;
                    response.RedirectLocation = Origin + "/";
                    return;
                }
                var cookie = request.Cookies[Cookie];
                if (cookie == null || !Matches(cookie.Value, session)) { Fail(response, 403, "session"); return; }
                if (method == "GET" && path == "/") { await Write(response, workspace, "text/html; charset=utf-8"); return; }
                if (method == "GET" && path == "/relay/status") {
                    var config = provider;
                    var info = config == null ? "{}" : new JavaScriptSerializer().Serialize(new { model = config.Model, destination = config.Endpoint.AbsoluteUri, revision = config.Revision });
                    await Write(response, Encoding.UTF8.GetBytes(info), "application/json; charset=utf-8");
                    return;
                }
                if (method != "POST" || path != "/relay/chat") { response.StatusCode = 404; return; }
                if (request.Headers["Origin"] != Origin || (request.Headers["Sec-Fetch-Site"] != null && request.Headers["Sec-Fetch-Site"] != "same-origin") ||
                    !String.Equals((request.ContentType ?? "").Split(';')[0], "application/json", StringComparison.OrdinalIgnoreCase)) { response.StatusCode = 403; return; }
                if (request.ContentLength64 < 1 || request.ContentLength64 > RequestLimit) { Fail(response, 413, "size"); return; }
                var target = provider;
                if (target == null || !Matches(request.Headers["X-CaseWeave-Revision"], target.Revision)) { Fail(response, 409, "changed"); return; }
                if (!await sendSlot.WaitAsync(0)) { response.StatusCode = 429; return; }
                try { await Forward(context, target); } finally { sendSlot.Release(); }
            } catch (IOException) { /* The browser closed the connection. */ }
            catch (HttpListenerException) { /* The browser or relay closed the connection. */ }
            catch (ObjectDisposedException) { /* The relay shut down. */ }
            catch (Exception) { try { Fail(response, 502, "unreachable"); } catch (Exception) { } }
            finally { response.Close(); }
        }

        async Task Forward(HttpListenerContext context, Provider target) {
            var response = context.Response;
            var serializer = new JavaScriptSerializer { MaxJsonLength = RequestLimit, RecursionLimit = 12 };
            var body = await Read(context.Request.InputStream, RequestLimit, CancellationToken.None);
            Dictionary<string, object> input;
            try { input = serializer.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body)); }
            catch (InvalidOperationException) { response.StatusCode = 400; return; }
            catch (ArgumentException) { response.StatusCode = 400; return; }
            object raw;
            if (input == null || !input.TryGetValue("messages", out raw)) { response.StatusCode = 400; return; }
            var messages = raw as System.Collections.IList;
            if (messages == null || messages.Count < 1 || messages.Count > 3) { response.StatusCode = 400; return; }
            var safe = new List<object>();
            foreach (var item in messages) {
                var message = item as Dictionary<string, object>;
                object role, content;
                if (message == null || !message.TryGetValue("role", out role) || !message.TryGetValue("content", out content) || !(content is string) || !(Object.Equals(role, "system") || Object.Equals(role, "user"))) { response.StatusCode = 400; return; }
                safe.Add(new { role = role, content = content });
            }
            if (!Object.ReferenceEquals(provider, target)) { Fail(response, 409, "changed"); return; }
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(75)))
            using (var call = new HttpRequestMessage(HttpMethod.Post, target.Endpoint)) {
                if (!String.IsNullOrEmpty(target.Key)) call.Headers.Authorization = new AuthenticationHeaderValue("Bearer", target.Key);
                call.Content = new StringContent(serializer.Serialize(new { model = target.Model, messages = safe, stream = false }), Encoding.UTF8, "application/json");
                try {
                    using (var result = await upstream.SendAsync(call, HttpCompletionOption.ResponseHeadersRead, timeout.Token)) {
                        if (!result.IsSuccessStatusCode) { response.StatusCode = (int)result.StatusCode >= 400 ? (int)result.StatusCode : 502; return; }
                        using (var stream = await result.Content.ReadAsStreamAsync()) {
                            var data = await Read(stream, ResponseLimit, timeout.Token);
                            if (data == null) { Fail(response, 413, "size"); return; }
                            if (target.Key.Length >= 12 && Encoding.UTF8.GetString(data).Contains(target.Key)) { Fail(response, 502, "credential"); return; }
                            await Write(response, data, "application/json; charset=utf-8");
                        }
                    }
                } catch (OperationCanceledException) { Fail(response, 504, "timeout"); }
                catch (HttpRequestException) { Fail(response, 502, "unreachable"); }
            }
        }

        static async Task<byte[]> Read(Stream input, int limit, CancellationToken token) {
            using (var bytes = new MemoryStream()) {
                var buffer = new byte[8192];
                int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length, token)) > 0) {
                    if (bytes.Length + count > limit) return null;
                    bytes.Write(buffer, 0, count);
                }
                return bytes.ToArray();
            }
        }

        static Task Write(HttpListenerResponse response, byte[] data, string type) {
            response.ContentType = type;
            response.ContentLength64 = data.LongLength;
            return response.OutputStream.WriteAsync(data, 0, data.Length);
        }

        static void Fail(HttpListenerResponse response, int status, string code) {
            response.StatusCode = status;
            response.Headers.Add("X-CaseWeave-Failure", code);
        }

        public void Dispose() { server.Close(); upstream.Dispose(); }
    }
}
