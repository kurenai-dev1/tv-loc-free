//
// ffprobe を呼び出すラッパー（ログ出力付き）
//
//    cl /O2 /EHsc ffprobe_wrapper.cpp
//    ffprobe.exe -> ffprobe_original.exe
//    ffprobe_wrapper.exe -> ffprobe.exe
//
#include <stdio.h>
#include <string>
#include <vector>
#include <windows.h>

// 文字列置換ヘルパー
std::string replaceAll(std::string str, const std::string& from, const std::string& to) {
    size_t start_pos = 0;
    while ((start_pos = str.find(from, start_pos)) != std::string::npos) {
        str.replace(start_pos, from.length(), to);
        start_pos += to.length();
    }
    return str;
}

// ログ出力関数
void writeLog(const char* originalCmd, const char* replacedCmd, DWORD errorNumber) {
    FILE* fp = NULL;
    fopen_s(&fp, "ffprobe_wrapper.log", "a");
    if (!fp) return;

    SYSTEMTIME st;
    GetLocalTime(&st);

    fprintf(fp, "[%04d-%02d-%02d %02d:%02d:%02d.%03d]\n",
            st.wYear, st.wMonth, st.wDay,
            st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);

    if (originalCmd) {
        fprintf(fp, "  [Original] %s\n", originalCmd);
    }
    if (replacedCmd) {
        fprintf(fp, "  [Replaced] %s\n", replacedCmd);
    }
    if (errorNumber != 0) {
        fprintf(fp, "  [Error] Failed to start ffprobe_original.exe. Code: %lu\n", errorNumber);
    }

    fprintf(fp, "--------------------------------------------------\n");
    fclose(fp);
}

int main() {
    // 1. Jellyfin が発行した全体のコマンドライン引数を取得
    std::string origCmdLine = GetCommandLineA();

    // 2. ffprobe の分析パラメータを爆速化・強制制限
    // 既存の probesize や analyzeduration があれば短縮し、無ければ先頭側に追加
    std::string cmdLine = origCmdLine;

    // 既存パラメータの置換（もし渡されていれば短縮）
    cmdLine = replaceAll(cmdLine, "-probesize 1G", "-probesize 500k");
    cmdLine = replaceAll(cmdLine, "-analyzeduration 3000000", "-analyzeduration 500000");

    // "ffprobe.exe" の直後に高速化パラメータを強制的に挟み込む
    // （分析にかかる時間を最大0.5秒、読み込み量を500KBに制限）
    size_t exePos = cmdLine.find("ffprobe");
    if (exePos != std::string::npos) {
        size_t spacePos = cmdLine.find(' ', exePos);
        if (spacePos != std::string::npos) {
            cmdLine.insert(spacePos + 1, "-analyzeduration 500000 -probesize 500k ");
        }
    }

    // ログにパラメータを書き出し
    writeLog(origCmdLine.c_str(), cmdLine.c_str(), 0);

    // 3. 呼び出す本物の ffprobe パス (同階層の ffprobe_original.exe)
    std::string targetExe = "ffprobe_original.exe";

    // 4. プロセス起動用の構造体準備
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    std::vector<char> cmdBuffer(cmdLine.begin(), cmdLine.end());
    cmdBuffer.push_back('\0');

    // 5. 本物の ffprobe を起動
    BOOL result = CreateProcessA(
        targetExe.c_str(),  // アプリケーション名
        cmdBuffer.data(),   // 置換後のコマンドライン引数
        NULL, NULL, FALSE, 0, NULL, NULL,
        &si, &pi
    );

    if (!result) {
        DWORD err = GetLastError();
        writeLog(NULL, NULL, err);
        return 1;
    }

    // 6. 終了待機（ただし ffprobe がフリーズした時の保険として最大 5 秒で切り捨てる）
    DWORD waitResult = WaitForSingleObject(pi.hProcess, 5000); // 5秒タイムアウト設定

    if (waitResult == WAIT_TIMEOUT) {
        // 5秒を超えて固まっている場合は強制終了して Jellyfin を解き放つ
        TerminateProcess(pi.hProcess, 1);
        writeLog(NULL, "Terminated due to timeout (5s)", 0);
    }

    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return static_cast<int>(exitCode);
}