import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

// Prevent Git from hanging on authentication prompts
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_ASKPASS = "true";

function runCmd(cmd: string, hideError = false): string {
  try {
    console.log(`[EXEC] ${cmd}`);
    return execSync(cmd, { stdio: "pipe" }).toString().trim();
  } catch (err: any) {
    if (hideError) return "";
    throw new Error(`Command failed: ${cmd}\nError: ${err.message}\nOutput: ${err.stderr?.toString()}`);
  }
}

async function run() {
  console.log("🚀 GitHub-қа кодты автоматты түрде пуш жасау процесі басталды...");

  const pat = (process.env.GITHUB_PAT || "").trim();
  const repo = (process.env.GITHUB_REPO || "").trim(); // e.g. "username/repo-name"

  if (!pat) {
    console.error("❌ Қате: GITHUB_PAT айнымалысы .env файлында немесе жүйелік айнымалыларда анықталмаған!");
    process.exit(1);
  }

  if (!repo) {
    console.error("❌ Қате: GITHUB_REPO айнымалысы .env файлында немесе жүйелік айнымалыларда анықталмаған! (Мысалы: i-ilyasuly/halaldamubot)");
    process.exit(1);
  }

  console.log(`ℹ️ Жүктелген деректер: REPO=${repo}, PAT ұзындығы=${pat.length}`);

  const cleanRepo = repo.replace(/^https:\/\/github.com\//, "").replace(/\.git$/, "");

  // Always ensure a valid git repository is initialized by cleaning up any broken .git folder
  try {
    console.log("📂 Бұзылған немесе зақымдалған Git репозиторийін толық тазартып, жаңадан инициализациялау...");
    const gitPath = path.join(process.cwd(), ".git");
    if (fs.existsSync(gitPath)) {
      fs.rmSync(gitPath, { recursive: true, force: true });
    }
    runCmd("git init");
  } catch (err: any) {
    console.warn("⚠️ git init орындау барысында ескерту:", err.message);
  }

  // Configure user details for commit
  runCmd('git config user.name "AI Studio Assistant"');
  runCmd('git config user.email "assistant@aistudio.google.com"');

  // Stage all files
  console.log("📦 Файлдарды индекстеуге (git add) қосу...");
  runCmd("git add .");

  // Determine current branch name
  let branch = "main";
  try {
    branch = runCmd("git rev-parse --abbrev-ref HEAD") || "main";
    if (branch === "HEAD") branch = "main";
  } catch {
    branch = "main";
  }

  // Check if there are changes to commit
  const status = runCmd("git status --porcelain");
  if (!status) {
    console.log("✨ Ешқандай өзгеріс табылмады. Код толықтай синхрондалған.");
  } else {
    // Commit changes
    console.log("💾 Өзгерістерді коммиттеу (git commit)...");
    const commitMsg = `Auto-sync: ${new Date().toISOString()}`;
    runCmd(`git commit -m "${commitMsg}"`, true);
  }

  // Rename branch to main if it is master/none
  try {
    runCmd("git branch -M main");
    branch = "main";
  } catch (err) {
    // Ignore if fails
  }

  // Configure remote authenticated origin URL using the PAT directly
  // Format: https://<PAT>@github.com/username/repo.git is standard for PAT authentication
  const authenticatedUrl = `https://${pat}@github.com/${cleanRepo}.git`;
  
  // Try to remove old origin
  runCmd("git remote remove origin", true);
  
  // Add fresh origin
  // We don't print the authenticated URL to avoid exposing the token in logs
  console.log("[EXEC] git remote add origin https://***@github.com/" + cleanRepo + ".git");
  try {
    execSync(`git remote add origin ${authenticatedUrl}`);
  } catch (err: any) {
    console.error("❌ remote add қатесі:", err.message);
  }

  console.log(`📤 GitHub-тағы ${cleanRepo} репозиторийінің '${branch}' тармағына (branch) пуштау белсенді...`);
  try {
    runCmd(`git push -u origin ${branch} --force`);
    console.log(`\n✅ СӘТТІ АЯҚТАЛДЫ! Код GitHub-қа жеткізілді: https://github.com/${cleanRepo}`);
  } catch (err: any) {
    console.error(`\n❌ Қате: GitHub-қа пуш жасау мүмкін болмады!`);
    console.error(err.message);
    process.exit(1);
  }
}

run();
