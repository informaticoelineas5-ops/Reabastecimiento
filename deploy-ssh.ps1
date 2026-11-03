$r = "u396942654@46.202.196.77"
$p = 65002
$d = "C:\Users\infor\OneDrive\Documentos\REAB\Reabastecimiento\dist"
$t = "~/domains/reabastecimiento.mercadoelineas.com/public_html"

Write-Host "=== Deploy REAB -> Hostinger ===" -ForegroundColor Cyan
Write-Host "  Host   : $r (puerto $p)"
Write-Host ""

Write-Host "[1/3] Subiendo archivos raiz..." -ForegroundColor Yellow
$rootFiles = Get-ChildItem "$d\*" -File | ForEach-Object { $_.FullName }
if ($rootFiles) {
    scp -P $p $rootFiles "${r}:${t}/"
}

Write-Host "[2/3] Subiendo assets..." -ForegroundColor Yellow
scp -P $p -r "$d\assets" "${r}:${t}/"

Write-Host "[3/3] Corrigiendo permisos..." -ForegroundColor Yellow
ssh -p $p $r "chmod 755 ~/domains/reabastecimiento.mercadoelineas.com/public_html/assets/"

Write-Host ""
Write-Host "Deploy completado." -ForegroundColor Green
Write-Host "https://reabastecimiento.mercadoelineas.com"
