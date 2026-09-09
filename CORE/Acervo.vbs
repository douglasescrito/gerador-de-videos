' Atalho de compatibilidade: usa a mesma inicializacao verificada do Studio.
Option Explicit
Dim shell, fso, coreDir, command, result
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
coreDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & coreDir & "\scripts\start-studio.ps1"""
result = shell.Run(command, 0, True)
If result <> 0 Then
  MsgBox "O Studio nao confirmou a abertura. Execute DIAGNOSTICAR.cmd na pasta principal e confira CORE\diagnosticos.", vbExclamation, "Gerador de Videos"
End If
