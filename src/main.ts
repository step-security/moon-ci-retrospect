import { readFile, stat } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

import * as core from "@actions/core";
import { parseJson } from "@moonrepo/dev";
import axios, { isAxiosError } from "axios";

import type { Action, ActionStatus, OperationMetaTaskExecution, RunReport } from "@moonrepo/types";

async function validateSubscription() {
  const eventPath = process.env['GITHUB_EVENT_PATH']
  let repoPrivate: boolean | undefined

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
    repoPrivate = eventData?.repository?.private
  }

  const upstream = 'appthrust/moon-ci-retrospect';
  const action = process.env['GITHUB_ACTION_REPOSITORY'];
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';

  core.info('');
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) core.info('\u001b[32m✓ Free for public repositories\u001b[0m');
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info('');

  if (repoPrivate === false) return;

  const serverUrl = process.env['GITHUB_SERVER_URL'] || 'https://github.com';
  const body: Record<string, string> = { action: action || '' };
  if (serverUrl !== 'https://github.com') body['ghes_server'] = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env['GITHUB_REPOSITORY']}/actions/maintained-actions-subscription`,
      body, { timeout: 3000 }
    );
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`);
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }
    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

interface TaskTarget {
	project: (string & {}) | "unknown";
	task: (string & {}) | "unknown";
}

// --- ANSI color helpers ---

function ansi(open: string, close: string, text: string): string {
	return `\u001b[${open}m${text}\u001b[${close}m`;
}

// --- Badges ---

const STATUS_BADGES: Record<ActionStatus, string> = {
	running: ansi("42", "49", " RUNNING "),
	passed: ansi("42", "49", " PASS "),

	failed: ansi("41", "49", " FAIL "),
	"timed-out": ansi("41", "49", " TIMED OUT "),
	aborted: ansi("41", "49", " ABORTED "),
	invalid: ansi("41", "49", " INVALID "),
	"failed-and-abort": ansi("41", "49", " FAILED AND ABORT "),

	skipped: ansi("44", "49", " SKIP "),
	cached: ansi("44", "49", " CACHED "),
	"cached-from-remote": ansi("44", "49", " REMOTE CACHED "),
};

const STD_BADGES = {
	out: ansi("48;5;236", "49", `　${ansi("32", "39", "⏺")} STDOUT　`),
	err: ansi("48;5;236", "49", `　${ansi("31", "39", "⏺")} STDERR　`),
} as const;

// --- Utilities ---

function sanitizePathComponent(component: string): string {
	let encoded = component.replaceAll("/", "-");
	encoded = encoded.replace(/[.-]+$/, "");
	encoded = encoded.replace(/^[.-]+/, "");
	return encoded;
}

function parseTarget(target: string): TaskTarget {
	const parts = target.split(":");
	return {
		project: parts[0] ?? "unknown",
		task: parts[1] ?? "unknown",
	};
}

function extractCommand(action: Action): OperationMetaTaskExecution["command"] {
	for (const operation of action.operations) {
		if (operation.meta.type === "task-execution") {
			return operation.meta.command;
		}
	}
	return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

// --- Core logic ---

async function findRunReport(workspaceRoot: string): Promise<RunReport | null> {
	for (const fileName of ["ciReport.json", "runReport.json"]) {
		const reportPath = path.join(workspaceRoot, ".moon/cache", fileName);

		core.debug(`Finding run report at .moon/cache/${fileName}`);

		if (await fileExists(reportPath)) {
			core.debug("Found!");
			return parseJson<RunReport>(reportPath);
		}
	}
	return null;
}

async function readTaskLogs(
	workspaceRoot: string,
	{ project, task }: TaskTarget,
): Promise<{ stdout: string; stderr: string }> {
	const logDir = `${workspaceRoot}/.moon/cache/states/${sanitizePathComponent(project)}/${sanitizePathComponent(task)}`;
	const stdoutPath = `${logDir}/stdout.log`;
	const stderrPath = `${logDir}/stderr.log`;

	const stdout = (await fileExists(stdoutPath)) ? await readFile(stdoutPath, { encoding: "utf8" }) : "";
	const stderr = (await fileExists(stderrPath)) ? await readFile(stderrPath, { encoding: "utf8" }) : "";

	return { stdout, stderr };
}

async function displayTaskResult(workspaceRoot: string, action: Action): Promise<void> {
	if (action.node.action !== "run-task") return;
	const taskTarget = parseTarget(action.node.params.target);
	const targetLabel = `${taskTarget.project}:${taskTarget.task}`;
	const command = extractCommand(action);
	const { stdout, stderr } = await readTaskLogs(workspaceRoot, taskTarget);

	core.startGroup(`${STATUS_BADGES[action.status]} ${ansi("1", "22", targetLabel)}`);

	if (typeof command === "string") {
		console.log(ansi("34", "39", `$ ${command}`));
	}

	if (stdout.trim() !== "") {
		console.log(STD_BADGES.out);
		console.log(stdout);
	}

	if (stderr.trim() !== "") {
		console.log(STD_BADGES.err);
		console.log(stderr);
	}

	core.endGroup();
}

async function run(): Promise<void> {
	await validateSubscription();

	const workspaceRoot = process.cwd();
	const report = await findRunReport(workspaceRoot);

	if (!report) {
		core.warning("Run report does not exist, has `moon ci` or `moon run` ran?");
		return;
	}

	for (const action of report.actions) {
		if (action.node.action !== "run-task") {
			continue;
		}
		await displayTaskResult(workspaceRoot, action);
	}
}

try {
	await run();
} catch (error) {
	console.error(error);
	process.exit(0);
}
