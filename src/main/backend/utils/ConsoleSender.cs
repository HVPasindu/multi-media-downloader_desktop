using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class ConsoleSender {
    private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const uint CREATE_NEW_CONSOLE = 0x00000010;
    private const uint CTRL_C_EVENT = 0;
    private const uint CTRL_BREAK_EVENT = 1;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const int STARTF_USESHOWWINDOW = 0x00000001;
    private const short SW_HIDE = 0;
    private const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

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

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    private static bool CtrlHandler(int ctrlType) {
        // Return true to indicate we handled/ignored the event
        return true;
    }

    private static readonly ConsoleCtrlDelegate handler = new ConsoleCtrlDelegate(CtrlHandler);

    private static string EscapeArgument(string arg) {
        if (string.IsNullOrEmpty(arg)) return "\"\"";
        if (!arg.Contains(" ") && !arg.Contains("\t") && !arg.Contains("\"")) return arg;
        return "\"" + arg.Replace("\"", "\\\"") + "\"";
    }

    public static int Main(string[] args) {
        if (args.Length < 1) {
            Console.WriteLine("Usage: send-ctrl-break <PID> OR send-ctrl-break spawn <cmd> [args...]");
            return 1;
        }

        // Mode 1: Spawn child process in dedicated console with CREATE_NEW_PROCESS_GROUP
        if (args[0] == "spawn") {
            if (args.Length < 2) {
                Console.WriteLine("Usage: send-ctrl-break spawn <executable> [args...]");
                return 1;
            }

            StringBuilder cmdLine = new StringBuilder();
            for (int i = 1; i < args.Length; i++) {
                if (i > 1) cmdLine.Append(" ");
                cmdLine.Append(EscapeArgument(args[i]));
            }

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(si);
            si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
            si.wShowWindow = SW_HIDE;
            si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

            PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
            uint flags = CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP;

            bool created = CreateProcess(null, cmdLine.ToString(), IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi);
            if (!created) {
                int err = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("Failed to launch process: " + err);
                return 1;
            }

            // Emit process PID marker for Node.js parent tracking
            Console.WriteLine("APPLAN2_PID:" + pi.dwProcessId);

            // Install CtrlHandler in the launcher so signals directed to this console don't terminate the launcher prematurely
            SetConsoleCtrlHandler(handler, true);

            WaitForSingleObject(pi.hProcess, INFINITE);

            uint exitCode = 0;
            GetExitCodeProcess(pi.hProcess, out exitCode);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);

            return (int)exitCode;
        }

        // Mode 2: Send CTRL_BREAK_EVENT to target process group
        uint pid;
        if (!uint.TryParse(args[0], out pid) || pid == 0) {
            Console.WriteLine("Invalid or prohibited PID: " + args[0]);
            return 1;
        }

        // Install handler BEFORE attaching to prevent self-interruption
        SetConsoleCtrlHandler(handler, true);

        FreeConsole();
        if (!AttachConsole(pid)) {
            int err = Marshal.GetLastWin32Error();
            Console.WriteLine("AttachConsole failed: " + err);
            return 2;
        }

        // Generate Ctrl+Break for target process group only (never broadcast to group 0)
        bool success = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid);

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
