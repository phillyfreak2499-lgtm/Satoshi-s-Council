# push.ps1 - stage, commit, and push everything in one step.
#
#   .\push.ps1 "your commit message"
#
# Shows you what it's about to commit and waits for confirmation.
# Render auto-deploys from main, so a successful push is also a deploy.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Message
)

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "Repo: $PSScriptRoot" -ForegroundColor DarkGray

# Warn if we're not on main, since Render only deploys main.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
    Write-Host "Note: you are on branch '$branch', not 'main'. Render deploys main only." -ForegroundColor Yellow
}

git add -A
if ($LASTEXITCODE -ne 0) {
    Write-Host "git add failed." -ForegroundColor Red
    exit 1
}

$staged = @(git diff --cached --name-only)
if ($staged.Count -eq 0) {
    Write-Host "Nothing to commit - working tree is clean." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "About to commit $($staged.Count) file(s):" -ForegroundColor Cyan
git status --short
Write-Host ""

# Anything that looks like a secret or a database should never reach GitHub.
$risky = $staged | Where-Object { $_ -match '\.(env|pem|key|db|sqlite3?)$' }
if ($risky) {
    Write-Host "WARNING - these look like secrets or data files:" -ForegroundColor Red
    $risky | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host "Add them to .gitignore instead of committing them." -ForegroundColor Red
    Write-Host ""
}

$reply = Read-Host "Commit and push? (y/n)"
if ($reply -ne 'y') {
    git reset | Out-Null
    Write-Host "Cancelled - nothing staged, nothing pushed." -ForegroundColor Yellow
    exit 0
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed - nothing was pushed." -ForegroundColor Red
    exit 1
}

git push
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push failed. Your commit is saved locally - fix the issue and run:" -ForegroundColor Red
    Write-Host "    git push" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Pushed to $branch. Render will auto-deploy." -ForegroundColor Green
