using System;
using CaseWeave;

static class RelayFixture {
    static void Main(string[] args) {
        using (var host = new RelayHost(args[0])) {
            host.SetProvider(args[1], args[2], "caseweave-qa-only");
            Console.WriteLine(host.CreateLaunchLink());
            while (true) {
                var command = Console.ReadLine();
                if (command == null || command == "stop") return;
                if (command == "change") {
                    host.SetProvider(args[1], args[2], "caseweave-qa-only");
                    Console.WriteLine("changed");
                }
            }
        }
    }
}
