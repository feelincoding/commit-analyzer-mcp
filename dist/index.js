"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const rest_1 = require("@octokit/rest");
// 1. 환경 변수 확인 (GitHub Token 필수)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN 환경 변수가 설정되지 않았습니다.");
    process.exit(1);
}
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
// 2. MCP 서버 생성
const server = new index_js_1.Server({
    name: "github-commit-analyzer",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// 3. 사용 가능한 도구 정의 (AI에게 노출될 기능)
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "analyze_commits",
                description: "특정 레포지토리의 최신 커밋들 간의 변경 사항(diff)을 가져옵니다.",
                inputSchema: {
                    type: "object",
                    properties: {
                        owner: { type: "string", description: "저장소 소유자 이름" },
                        repo: { type: "string", description: "저장소 이름" },
                        per_page: { type: "number", description: "분석할 커밋 개수 (기본 3개)", default: 3 },
                    },
                    required: ["owner", "repo"],
                },
            },
            {
                name: "update_readme",
                description: "README.md 파일의 마지막에 새로운 내용을 추가합니다.",
                inputSchema: {
                    type: "object",
                    properties: {
                        owner: { type: "string", description: "저장소 소유자 이름" },
                        repo: { type: "string", description: "저장소 이름" },
                        content: { type: "string", description: "추가할 요약 내용" },
                    },
                    required: ["owner", "repo", "content"],
                },
            },
        ],
    };
});
// 4. 도구 실행 로직 구현
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "analyze_commits") {
            const { owner, repo, per_page = 3 } = args;
            const { data: commits } = await octokit.rest.repos.listCommits({
                owner,
                repo,
                per_page,
            });
            const diffs = await Promise.all(commits.map(async (commit) => {
                const { data } = await octokit.rest.repos.getCommit({
                    owner,
                    repo,
                    ref: commit.sha,
                    headers: { accept: "application/vnd.github.v3.diff" },
                });
                return `Commit: ${commit.commit.message}\nDiff:\n${data}\n`;
            }));
            return { content: [{ type: "text", text: diffs.join("\n---\n") }] };
        }
        if (name === "update_readme") {
            const { owner, repo, content } = args;
            // 기존 파일 내용 가져오기
            const { data: readme } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: "README.md",
            });
            if ("content" in readme) {
                const currentContent = Buffer.from(readme.content, "base64").toString();
                const newContent = `${currentContent}\n\n## 최근 변경 사항 (AI 분석)\n${content}`;
                await octokit.rest.repos.createOrUpdateFileContents({
                    owner,
                    repo,
                    path: "README.md",
                    message: "docs: update README with commit analysis",
                    content: Buffer.from(newContent).toString("base64"),
                    sha: readme.sha,
                });
                return { content: [{ type: "text", text: "README.md가 성공적으로 업데이트되었습니다." }] };
            }
        }
        throw new Error(`Tool not found: ${name}`);
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: `에러 발생: ${error.message}` }],
        };
    }
});
// 5. 서버 시작
const transport = new stdio_js_1.StdioServerTransport();
server.connect(transport).catch((error) => {
    console.error("서버 연결 중 에러가 발생했습니다:", error);
    process.exit(1);
});
