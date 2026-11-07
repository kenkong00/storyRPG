' 双击这个文件启动服务（窗口最小化，不会挡在前面）
' 想看日志就双击「启动.bat」
Option Explicit
Dim sh, fso, base, q
q = Chr(34)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
sh.Run q & base & "\启动.bat" & q, 7, False
