@echo off
pushd "%~dp0CORE"
echo Verificando dependencias e endpoint Omni.
echo O endpoint Omni padrao usa porta 3000; este nao e o app visual na porta 5599.
echo health unreachable nao comprova falha do app visual ou dos renderers locais.
node scripts\omni-cli.mjs doctor
echo.
echo Verificando somente o estado das sessoes locais:
node scripts\persistent-session.mjs status
popd
pause
