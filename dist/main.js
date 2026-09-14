// src/main.js
import * as core3 from "@actions/core";
import semver from "semver";

// src/lib/setup.js
import core from "@actions/core";
import { readdirSync } from "fs";
import path from "path";
var Setup = class {
  static debug() {
    const dir = readdirSync(path.resolve(process.env.GITHUB_WORKSPACE), { withFileTypes: true }).map((entry) => {
      return `${entry.isDirectory() ? "> " : "  - "}${entry.name}`;
    }).join("\n");
    console.log({ dir });
    core.debug(` Working Directory: ${process.env.GITHUB_WORKSPACE}:
${dir}`);
  }
  static requireAnyEnv() {
    for (const arg of arguments) {
      if (!process.env.hasOwnProperty(arg)) {
        return;
      }
    }
    throw new Error("At least one of the following environment variables is required: " + Array.slice(arguments).join(", "));
  }
};

// src/lib/package.js
import fs from "fs";
import path2 from "path";
var Package = class {
  constructor(root = "./") {
    root = path2.join(process.env.GITHUB_WORKSPACE, root);
    if (fs.statSync(root).isDirectory()) {
      root = path2.join(root, "package.json");
    }
    if (!fs.existsSync(root)) {
      throw new Error(`package.json does not exist at ${root}.`);
    }
    this.root = root;
    this.data = JSON.parse(fs.readFileSync(root));
  }
  get version() {
    return this.data.version;
  }
};

// src/lib/tag.js
import core2 from "@actions/core";
import { Octokit } from "octokit";
var github = new Octokit({ auth: process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN }).rest;
var [owner, repo] = process.env.GITHUB_ACTION_REPOSITORY.split("/");
var Tag = class {
  constructor(prefix, version, postfix) {
    this.prefix = prefix;
    this.version = version;
    this.postfix = postfix;
    this._tags = null;
    this._message = null;
    this._exists = null;
    this._sha = "";
    this._uri = "";
    this._ref = "";
  }
  get name() {
    return `${this.prefix.trim()}${this.version.trim()}${this.postfix.trim()}`;
  }
  set message(value) {
    if (value && value.length > 0) {
      this._message = value;
    }
  }
  get message() {
    return this._message || "";
  }
  get sha() {
    return this._sha || "";
  }
  get uri() {
    return this._uri || "";
  }
  get ref() {
    return this._ref || "";
  }
  get prerelease() {
    return /([0-9\.]{5}(-[\w\.0-9]+)?)/i.test(this.version);
  }
  get build() {
    return /([0-9\.]{5}(\+[\w\.0-9]+)?)/i.test(this.version);
  }
  async getMessage() {
    if (this._message !== null) {
      return this._message;
    }
    try {
      let tags = await this.getTags();
      if (tags.length === 0) {
        return `Version ${this.version}`;
      }
      const changelog = await github.repos.compareCommits({ owner, repo, base: tags.shift().name, head: process.env.GITHUB_HEAD_REF ?? "main" });
      const tpl = (core2.getInput("commit_message_template", { required: false }) || "").trim();
      return changelog.data.commits.map(
        (commit, i) => {
          if (tpl.length > 0) {
            return tpl.replace(/\{\{\s?(number)\s?\}\}/gi, i + 1).replace(/\{\{\s?(message)\s?\}\}/gi, commit.commit.message).replace(/\{\{\s?(author)\s?\}\}/gi, commit.hasOwnProperty("author") ? commit.author.hasOwnProperty("login") ? commit.author.login : "" : "").replace(/\{\{\s?(sha)\s?\}\}/gi, commit.sha).trim() + "\n";
          } else {
            return `${i === 0 ? "\n" : ""}${i + 1}) ${commit.commit.message}${commit.hasOwnProperty("author") ? commit.author.hasOwnProperty("login") ? " (" + commit.author.login + ")" : "" : ""}
(SHA: ${commit.sha})
`;
          }
        }
      ).join("\n");
    } catch (e) {
      core2.warning("Failed to generate changelog from commits: " + e.message + "\n");
      return `Version ${this.version}`;
    }
  }
  async getTags() {
    if (this._tags !== null) {
      return this._tags.data;
    }
    this._tags = await github.repos.listTags({ owner, repo, per_page: 100 });
    return this._tags.data;
  }
  async exists() {
    if (this._exists !== null) {
      return this._exists;
    }
    const currentTag = this.name;
    const tags = await this.getTags();
    for (const tag of tags) {
      if (tag.name === currentTag) {
        this._exists = true;
        return true;
      }
    }
    this._exists = false;
    return false;
  }
  async push() {
    let tagexists = await this.exists();
    if (!tagexists) {
      const message = await this.getMessage();
      const newTag = await github.git.createTag({
        owner,
        repo,
        tag: this.name,
        message,
        object: process.env.GITHUB_SHA,
        type: "commit"
      });
      this._sha = newTag.data.sha;
      core2.warning(`Created new tag: ${newTag.data.tag}`);
      let newReference;
      try {
        newReference = await github.git.createRef({
          owner,
          repo,
          ref: `refs/tags/${newTag.data.tag}`,
          sha: newTag.data.sha
        });
      } catch (e) {
        core2.warning({
          owner,
          repo,
          ref: `refs/tags/${newTag.data.tag}`,
          sha: newTag.data.sha
        });
        throw e;
      }
      this._uri = newReference.data.url;
      this._ref = newReference.data.ref;
      this._message = message;
      core2.warning(`Reference ${newReference.data.ref} available at ${newReference.data.url}
`);
    } else {
      core2.warning("Cannot push tag (it already exists).");
    }
  }
};

// src/lib/regex.js
import { statSync, readFileSync } from "fs";
import { resolve } from "path";
var Regex = class {
  constructor(root = "./", pattern) {
    root = resolve(root);
    if (statSync(root).isDirectory()) {
      throw new Error(`${root} is a directory. The Regex tag identification strategy requires a file.`);
    }
    if (!existsSync(root)) {
      throw new Error(`"${root}" does not exist.`);
    }
    this.content = readFileSync(root).toString();
    let content = pattern.exec(this.content);
    if (!content) {
      this._version = null;
    } else if (content.groups && content.groups.version) {
      this._version = content.groups.version;
    } else {
      this._version = content[1];
    }
  }
  get version() {
    return this._version;
  }
  get versionFound() {
    return this._version !== null;
  }
};

// src/lib/docker.js
import { join } from "path";
import { statSync as statSync2 } from "fs";
var Dockerfile = class extends Regex {
  constructor(root = null) {
    root = join(process.env.GITHUB_WORKSPACE, root);
    if (statSync2(root).isDirectory()) {
      root = join(root, "Dockerfile");
    }
    super(root, /LABEL[\s\t]+version=[\t\s+]?[\"\']?([0-9\.]+)[\"\']?/i);
  }
};

// src/main.js
async function run() {
  try {
    Setup.debug();
    Setup.requireAnyEnv("GITHUB_TOKEN", "INPUT_GITHUB_TOKEN");
    core3.setOutput("tagcreated", "no");
    const versionSupplied = core3.getInput("root", { required: false }) !== null && core3.getInput("root", { required: false }) !== void 0 && core3.getInput("root", { required: false }).trim().length > 0;
    const strategy = versionSupplied ? "manual" : (core3.getInput("regex_pattern", { required: false }) || "").trim().length > 0 ? "regex" : (core3.getInput("strategy", { required: false }) || "package").trim().toLowerCase();
    const root = core3.getInput("root", { required: false }) || core3.getInput("package_root", { required: false }) || (strategy === "composer" ? "./composer.json" : "./");
    const isDryRun = (core3.getInput("dry_run", { required: false }) || "").trim().toLowerCase() === "true";
    let version = core3.getInput("root", { required: false });
    version = version === null || version.trim().length === v0 ? null : version;
    const pattern = core3.getInput("regex_pattern", { required: false });
    switch (strategy) {
      case "docker":
        version = new Dockerfile(root).version;
        break;
      case "composer":
      case "package":
        version = new Package(root).version;
        break;
      case "regex":
        version = new Regex(root, new RegExp(pattern, "gim")).version;
        break;
      case "manual":
        core3.notice(`"${version}" version was manually specified in the action configuration`);
        break;
      default:
        core3.setFailed(`"${strategy}" is not a recognized tagging strategy. Choose from: 'package' (package.json), 'composer' (composer.json), 'docker' (uses Dockerfile), or 'regex' (JS-based RegExp). Specify a version to use the "manual" strategy.`);
        return;
    }
    const msg = ` using the ${strategy} extraction${strategy === "regex" ? " with the /" + pattern + "/gim pattern." : ""}.`;
    if (!version) {
      throw new Error(`No version identified${msg}`);
    }
    const minVersion = core3.getInput("min_version", { required: false });
    const versionSemVer = semver.coerce(version);
    const minVersionSemVer = semver.coerce(minVersion);
    if (!minVersionSemVer) {
      core3.info(`Skipping min version check. ${minVersion} is not valid SemVer`);
    }
    if (!versionSemVer) {
      core3.info(`Skipping min version check. ${version} is not valid SemVer`);
    }
    if (minVersionSemVer && versionSemVer && semver.lt(versionSemVer, minVersionSemVer)) {
      core3.info(`Version "${version}" is lower than minimum "${minVersion}"`);
      return;
    }
    core3.notice(`Recognized "${version}"${msg}`);
    core3.setOutput("version", version);
    core3.debug(` Detected version ${version}`);
    const tag = new Tag(
      core3.getInput("tag_prefix", { required: false }),
      version,
      core3.getInput("tag_suffix", { required: false })
    );
    if (isDryRun) {
      core3.notice(`"${tag.name}" tag was not pushed because the dry_run option was set.`);
    } else {
      core3.info(`Attempting to create ${tag.name} tag.`);
    }
    core3.setOutput("tagrequested", tag.name);
    core3.setOutput("prerelease", tag.prerelease ? "yes" : "no");
    core3.setOutput("build", tag.build ? "yes" : "no");
    if (await tag.exists()) {
      core3.setFailed(`"${tag.name}" tag already exists.
`);
      core3.setOutput("tagname", "");
      return;
    }
    tag.message = core3.getInput("tag_message", { required: false }).trim();
    if (!isDryRun) {
      await tag.push();
      core3.setOutput("tagcreated", "yes");
    }
    core3.setOutput("tagname", tag.name);
    core3.setOutput("tagsha", tag.sha);
    core3.setOutput("taguri", tag.uri);
    core3.setOutput("tagmessage", tag.message);
    core3.setOutput("tagref", tag.ref);
  } catch (error) {
    core3.warning(error.message + "\n" + error.stack);
    core3.setOutput("tagname", "");
    core3.setOutput("tagsha", "");
    core3.setOutput("taguri", "");
    core3.setOutput("tagmessage", "");
    core3.setOutput("tagref", "");
    core3.setOutput("tagcreated", "no");
  }
}
run();
