using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public class ConsoleSender {
    private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const uint CTRL_C_EVENT = 0;
    private const uint CTRL_BREAK_EVENT = 1;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const int STARTF_USESHOWWINDOW = 0x00000001;
    private const short SW_HIDE = 0;
    private const uint INFINITE = 0xFFFFFFFF;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;

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
    private static extern bool AllocConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

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
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

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
            Console.WriteLine("Usage: send-ctrl-break <PID> OR send-ctrl-break spawn <cmd> [args...] OR send-ctrl-break --version");
            return 1;
        }

        // Mode 0: Version inquiry
        if (args[0] == "--version" || args[0] == "-v") {
            Console.WriteLine("send-ctrl-break version 1.0.0");
            return 0;
        }

        // Mode 1: Spawn child process in dedicated hidden console with CREATE_NEW_PROCESS_GROUP
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

            // 1. Capture original standard handles from parent process (Node.js pipes)
            IntPtr hOrigIn = GetStdHandle(STD_INPUT_HANDLE);
            IntPtr hOrigOut = GetStdHandle(STD_OUTPUT_HANDLE);
            IntPtr hOrigErr = GetStdHandle(STD_ERROR_HANDLE);

            if (hOrigOut == IntPtr.Zero || hOrigOut == new IntPtr(-1)) {
                Console.Error.WriteLine("GetStdHandle (stdout) returned invalid handle");
                return 1;
            }
            if (hOrigErr == IntPtr.Zero || hOrigErr == new IntPtr(-1)) {
                Console.Error.WriteLine("GetStdHandle (stderr) returned invalid handle");
                return 1;
            }

            // Ensure handles are marked inheritable (fail-closed on critical handle configuration failure)
            if (hOrigIn != IntPtr.Zero && hOrigIn != new IntPtr(-1)) {
                if (!SetHandleInformation(hOrigIn, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
                    int hErr = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("SetHandleInformation (stdin) failed: " + hErr);
                    return 1;
                }
            }
            if (!SetHandleInformation(hOrigOut, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
                int hErr = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("SetHandleInformation (stdout) failed: " + hErr);
                return 1;
            }
            if (!SetHandleInformation(hOrigErr, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) {
                int hErr = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("SetHandleInformation (stderr) failed: " + hErr);
                return 1;
            }

            // 2. Detach from current console (if any) and allocate a new dedicated console
            FreeConsole();
            if (!AllocConsole()) {
                int allocErr = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("AllocConsole failed: " + allocErr);
                return 1;
            }

            // 3. Immediately hide the newly allocated console window
            IntPtr hWnd = GetConsoleWindow();
            if (hWnd != IntPtr.Zero) {
                ShowWindow(hWnd, SW_HIDE);
            }

            // 4. Redirect C# Console.Out and Console.Error back to the original Node.js pipes
            if (hOrigOut != IntPtr.Zero && hOrigOut != new IntPtr(-1)) {
                SafeFileHandle sfhOut = new SafeFileHandle(hOrigOut, false);
                FileStream fsOut = new FileStream(sfhOut, FileAccess.Write);
                StreamWriter swOut = new StreamWriter(fsOut, Encoding.UTF8) { AutoFlush = true };
                Console.SetOut(swOut);
            }
            if (hOrigErr != IntPtr.Zero && hOrigErr != new IntPtr(-1)) {
                SafeFileHandle sfhErr = new SafeFileHandle(hOrigErr, false);
                FileStream fsErr = new FileStream(sfhErr, FileAccess.Write);
                StreamWriter swErr = new StreamWriter(fsErr, Encoding.UTF8) { AutoFlush = true };
                Console.SetError(swErr);
            }

            // 5. Configure STARTUPINFO with the original pipe handles
            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(si);
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = hOrigIn;
            si.hStdOutput = hOrigOut;
            si.hStdError = hOrigErr;

            PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
            uint flags = CREATE_NEW_PROCESS_GROUP;

            bool created = false;
            bool normalExit = false;
            bool handlerInstalled = false;
            int finalExitCode = 1;

            try {
                created = CreateProcess(null, cmdLine.ToString(), IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi);
                if (!created) {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("Failed to launch process: " + err);
                    return 1;
                }

                // Emit process PID and PGID markers for Node.js parent tracking
                Console.WriteLine("APPLAN2_PID:" + pi.dwProcessId);
                Console.WriteLine("APPLAN2_PGID:" + pi.dwProcessId);

                // Install CtrlHandler in the launcher so signals directed to this console do not terminate the launcher prematurely
                if (!SetConsoleCtrlHandler(handler, true)) {
                    int hErr = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("SetConsoleCtrlHandler failed: " + hErr);
                    return 1;
                }
                handlerInstalled = true;

                uint waitResult = WaitForSingleObject(pi.hProcess, INFINITE);
                if (waitResult == 0xFFFFFFFF) {
                    int waitErr = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("WaitForSingleObject failed: " + waitErr);
                    return 1;
                }

                uint exitCode = 0;
                if (!GetExitCodeProcess(pi.hProcess, out exitCode)) {
                    int exitErr = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("GetExitCodeProcess failed: " + exitErr);
                    return 1;
                }

                normalExit = true;
                finalExitCode = (int)exitCode;
                return finalExitCode;
            } finally {
                if (created && !normalExit && pi.hProcess != IntPtr.Zero) {
                    try {
                        TerminateProcess(pi.hProcess, 1);
                        WaitForSingleObject(pi.hProcess, 5000);
                    } catch {}
                }

                if (handlerInstalled) {
                    try {
                        SetConsoleCtrlHandler(handler, false);
                    } catch {}
                }

                if (pi.hProcess != IntPtr.Zero) {
                    CloseHandle(pi.hProcess);
                    pi.hProcess = IntPtr.Zero;
                }
                if (pi.hThread != IntPtr.Zero) {
                    CloseHandle(pi.hThread);
                    pi.hThread = IntPtr.Zero;
                }

                FreeConsole();
            }
        }

        // Mode 2: Send CTRL_BREAK_EVENT to target process group
        uint pid;
        if (!uint.TryParse(args[0], out pid) || pid == 0) {
            Console.WriteLine("Invalid or prohibited PID: " + args[0]);
            return 1;
        }

        bool handlerInstalledMode2 = false;
        try {
            // Install handler BEFORE attaching to prevent self-interruption
            if (!SetConsoleCtrlHandler(handler, true)) {
                int hErr = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("SetConsoleCtrlHandler failed: " + hErr);
                return 1;
            }
            handlerInstalledMode2 = true;

            FreeConsole();
            if (!AttachConsole(pid)) {
                int err = Marshal.GetLastWin32Error();
                Console.WriteLine("AttachConsole failed: " + err);
                return 2;
            }

            bool success = false;
            try {
                // Generate Ctrl+Break for target process group only (never broadcast to group 0)
                success = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid);
            } finally {
                FreeConsole();
            }

            if (success) {
                Console.WriteLine("CTRL_BREAK_SENT");
                return 0;
            } else {
                Console.WriteLine("GenerateConsoleCtrlEvent failed: " + Marshal.GetLastWin32Error());
                return 3;
            }
        } finally {
            if (handlerInstalledMode2) {
                try {
                    SetConsoleCtrlHandler(handler, false);
                } catch {}
            }
        }
    }
}
