//
// FFmpeg を呼び出すラッパー
//
//    cl /O2 /EHsc ffmpeg_wrapper.cpp
//    ffmpeg.exe -> ffmpeg_original.exe
//    ffmpeg_wrapper.exe -> ffmpeg.exe
//
#include <iostream>
#include <string>
#include <vector>
#include <windows.h>

// 文字列置換ヘルパー
std::string replaceAll(std::string str, const std::string& from, const std::string& to) {
    size_t start_pos = 0;
    while((start_pos = str.find(from, start_pos)) != std::string::npos) {
        str.replace(start_pos, from.length(), to);
        start_pos += to.length();
    }
    return str;
}

int main() {
    // 1. Jellyfin が発行した全体のコマンドライン引数を取得
    std::string cmdLine = GetCommandLineA();

    // 2. 問題のパラメータを低遅延用パラメータに置換
    // -probesize 1G -> -probesize 500k
    cmdLine = replaceAll(cmdLine, "-probesize 1G", "-probesize 500k");
    
    // -analyzeduration 3000000 -> -analyzeduration 500000 (必要に応じて)
    cmdLine = replaceAll(cmdLine, "-analyzeduration 3000000", "-analyzeduration 500000");

    // 3. 呼び出す本物の FFmpeg パス (同階層の ffmpeg_original.exe)
    std::string targetExe = "ffmpeg_original.exe";

    // 4. プロセス起動用の構造体準備
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    // CreateProcess 用に書き換え可能なチャル配列を用意
    std::vector<char> cmdBuffer(cmdLine.begin(), cmdLine.end());
    cmdBuffer.push_back('\0');

    // 5. 本物の FFmpeg を起動
    BOOL result = CreateProcessA(
        targetExe.c_str(),  // アプリケーション名
        cmdBuffer.data(),   // 置換後のコマンドライン引数
        NULL, NULL, FALSE, 0, NULL, NULL,
        &si, &pi
    );

    if (!result) {
        std::cerr << "[Wrapper Error] Failed to start ffmpeg_original.exe. Error: " << GetLastError() << std::endl;
        return 1;
    }

    // 6. 本物の FFmpeg が終了するまで待機し、終了コードをそのまま返す
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return static_cast<int>(exitCode);
}