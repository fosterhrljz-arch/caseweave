using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Windows.Forms;

namespace CaseWeave {
    static class Program {
        [STAThread]
        static void Main() {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var language = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh";
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist", "index.html");
            try {
                using (var host = new RelayHost(path)) Application.Run(new RelayWindow(host, language));
            } catch (Exception) {
                MessageBox.Show(language ? "无法启动 CaseWeave。请确认已解压完整文件夹且端口 4179 可用。" : "CaseWeave could not start. Extract the complete release and make sure port 4179 is available.", "CaseWeave", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    sealed class RelayWindow : Form {
        readonly RelayHost host;
        readonly ComboBox language = new ComboBox();
        readonly TextBox url = new TextBox(), model = new TextBox(), key = new TextBox();
        readonly Label intro = new Label(), urlLabel = new Label(), modelLabel = new Label(), keyLabel = new Label(), status = new Label();
        readonly Button save = new Button(), clear = new Button(), open = new Button();
        bool zh, configured;

        public RelayWindow(RelayHost host, bool chinese) {
            this.host = host;
            zh = chinese;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(520, 435);
            ClientSize = new Size(555, 410);
            Font = new Font("Segoe UI", 10);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoScroll = true, Padding = new Padding(15) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            var band = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
            language.DropDownStyle = ComboBoxStyle.DropDownList;
            language.Items.AddRange(new object[] { "English", "简体中文" });
            language.SelectedIndex = zh ? 1 : 0;
            language.SelectedIndexChanged += (sender, eventArgs) => { zh = language.SelectedIndex == 1; SetLabels(); };
            band.Controls.Add(language);
            AddFull(layout, band);
            intro.AutoSize = true;
            intro.MaximumSize = new Size(485, 0);
            intro.Margin = new Padding(3, 9, 3, 12);
            AddFull(layout, intro);
            url.Text = "https://api.openai.com/v1";
            model.Text = "gpt-4o-mini";
            key.UseSystemPasswordChar = true;
            key.MaxLength = 4096;
            AddField(layout, urlLabel, url);
            AddField(layout, modelLabel, model);
            AddField(layout, keyLabel, key);
            status.AutoSize = true;
            status.MaximumSize = new Size(485, 0);
            status.Margin = new Padding(3, 11, 3, 10);
            AddFull(layout, status);
            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            foreach (var button in new[] { save, clear, open }) { button.AutoSize = true; buttons.Controls.Add(button); }
            AddFull(layout, buttons);
            save.Click += (sender, eventArgs) => Save();
            clear.Click += (sender, eventArgs) => { host.ClearProvider(); configured = false; key.Clear(); SetLabels(); };
            open.Click += (sender, eventArgs) => OpenWorkspace();
            Controls.Add(layout);
            SetLabels();
        }

        string T(string en, string cn) { return zh ? cn : en; }

        void SetLabels() {
            Text = T("CaseWeave Windows AI relay", "CaseWeave Windows AI 中继");
            intro.Text = T("This optional window sends approved AI requests to the endpoint you configure here. It keeps the provider key in Windows process memory. Leave the window open while using the relay.", "此窗口将经你确认的 AI 请求发送到指定端点。服务密钥保留在 Windows 进程内存中。使用中继期间请保持窗口开启。");
            urlLabel.Text = T("API base URL", "API 基础网址"); modelLabel.Text = T("Model", "模型"); keyLabel.Text = T("API key", "API 密钥");
            save.Text = T("Save provider", "保存服务配置"); clear.Text = T("Clear provider", "清除服务配置"); open.Text = T("Open workspace", "打开工作区");
            status.Text = configured ? T("Provider saved for this session. In CaseWeave Settings, choose Test Windows relay.", "已保存本次会话的服务配置。请在 CaseWeave 设置中选择测试 Windows 中继。") : T("The workspace opens with AI disconnected. A key is optional for a local provider.", "工作区打开时 AI 尚未连接。本地服务可不填写密钥。");
        }

        void Save() {
            try { host.SetProvider(url.Text, model.Text, key.Text); configured = true; key.Clear(); SetLabels(); }
            catch (ArgumentException error) {
                status.Text = error.Message == "model" ? T("Enter the provider's model name.", "请输入服务提供方的模型名称。") : error.Message == "key" ? T("Enter a valid single-line API key.", "请输入有效的单行 API 密钥。") : T("Use an HTTPS endpoint or a loopback HTTP URL, without embedded credentials or query parameters.", "请输入 HTTPS 端点或本机回环 HTTP 网址，且不包含凭据或查询参数。");
            }
        }

        void OpenWorkspace() {
            try { Process.Start(new ProcessStartInfo(host.CreateLaunchLink()) { UseShellExecute = true }); }
            catch (Exception) { status.Text = T("Windows could not launch the default web browser.", "Windows 无法启动默认浏览器。"); }
        }

        static void AddFull(TableLayoutPanel table, Control control) {
            int row = table.RowCount++;
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.Controls.Add(control, 0, row);
            table.SetColumnSpan(control, 2);
        }

        static void AddField(TableLayoutPanel table, Label label, TextBox input) {
            int row = table.RowCount++;
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            label.AutoSize = true;
            label.Anchor = AnchorStyles.Left;
            input.Dock = DockStyle.Fill;
            input.Margin = new Padding(3, 5, 3, 6);
            table.Controls.Add(label, 0, row);
            table.Controls.Add(input, 1, row);
        }
    }
}
