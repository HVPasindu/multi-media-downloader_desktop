using System;
using System.Runtime.InteropServices;

public class ConsoleSender {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate bool ConsoleCtrlDelegate(int ctrlType);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleCtrlHandler(ConsoleCtrlDelegate HandlerRoutine, bool Add);

    private const uint CTRL_C_EVENT = 0;
    private const uint CTRL_BREAK_EVENT = 1;

    private static bool CtrlHandler(int ctrlType) {
        // Return true to indicate we handled/ignored the event
        return true;
    }

    private static readonly ConsoleCtrlDelegate handler = new ConsoleCtrlDelegate(CtrlHandler);

    public static int Main(string[] args) {
        if (args.Length < 1) {
            Console.WriteLine("Usage: send-ctrl-break <PID>");
            return 1;
        }

        uint pid;
        if (!uint.TryParse(args[0], out pid)) {
            Console.WriteLine("Invalid PID: " + args[0]);
            return 1;
        }

        // Install handler BEFORE attaching
        SetConsoleCtrlHandler(handler, true);

        FreeConsole();
        if (!AttachConsole(pid)) {
            int err = Marshal.GetLastWin32Error();
            Console.WriteLine("AttachConsole failed: " + err);
            return 2;
        }

        // Generate Ctrl+Break for target process group
        bool success = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid);
        if (!success) {
            success = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, 0);
        }

        FreeConsole();

        if (success) {
            Console.WriteLine("CTRL_BREAK_SENT");
            return 0;
        } else {
            Console.WriteLine("GenerateConsoleCtrlEvent failed: " + Marshal.GetLastWin32Error());
            return 3;
        }
    }
}
