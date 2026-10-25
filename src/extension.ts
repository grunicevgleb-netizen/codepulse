
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import {
    getDateKey,
    StatisticsStore,
    type Statistics
} from './statistics';

const statsKey = 'codepulse.stats.v2';
const saveIntervalMs = 30000;

let activeStore: StatisticsStore | undefined;

function getProjectName(file: string): string {
    const uri = vscode.Uri.file(file);
    const folder = vscode.workspace.getWorkspaceFolder(uri);

    if (folder) {
        return folder.name;
    }

    return 'Без проекта';
}

export function activate(context: vscode.ExtensionContext) {

    let activeFile = '';
    let lastActivity = 0;

    const store = new StatisticsStore(
        context.globalState.get<Statistics>(statsKey, {}),
        statistics => context.globalState.update(statsKey, statistics)
    );

    activeStore = store;

    let panel: vscode.WebviewPanel | undefined;

    function setActiveFile(editor: vscode.TextEditor | undefined) {
        if (!editor || editor.document.uri.scheme !== 'file') {
            activeFile = '';
            lastActivity = 0;
            return;
        }

        activeFile = editor.document.fileName;
        lastActivity = Date.now();
    }

    setActiveFile(vscode.window.activeTextEditor);

    const editorListener = vscode.window.onDidChangeActiveTextEditor(
        editor => {
            setActiveFile(editor);
        }
    );

    const changeListener = vscode.workspace.onDidChangeTextDocument(
        event => {
            const editor = vscode.window.activeTextEditor;

            if (!editor || event.contentChanges.length === 0) {
                return;
            }

            if (event.document.uri.toString() !==
                editor.document.uri.toString()) {
                return;
            }

            setActiveFile(editor);
        }
    );

    const selectionListener = vscode.window.onDidChangeTextEditorSelection(
        event => {
            if (event.textEditor === vscode.window.activeTextEditor) {
                setActiveFile(event.textEditor);
            }
        }
    );

    context.subscriptions.push(
        editorListener,
        changeListener,
        selectionListener
    );

    function sendStatistics() {
        if (panel) {
            void panel.webview.postMessage({
                type: 'statistics',
                data: store.values()
            });
        }
    }

    const dashboard = vscode.commands.registerCommand(
        'codepulse.openDashboard',
        () => {

            if (panel) {
                panel.reveal();
                return;
            }

            panel = vscode.window.createWebviewPanel(
                'codepulseDashboard',
                'CodePulse Statistics',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getDashboardHtml(panel.webview);

            panel.webview.onDidReceiveMessage(message => {
                if (message.type === 'ready') {
                    sendStatistics();
                }
            }, null, context.subscriptions);

            panel.onDidDispose(() => {
                panel = undefined;
            });
        }
    );

    context.subscriptions.push(dashboard);

    const timer = setInterval(() => {

        if (!activeFile) {
            return;
        }

        if (!vscode.window.state.focused) {
            return;
        }

        if (Date.now() - lastActivity > 60000) {
            return;
        }

        const date = getDateKey();
        const project = getProjectName(activeFile);

        store.addSecond(activeFile, project, date);

        sendStatistics();

    }, 1000);

    const saveTimer = setInterval(() => {
        void store.flush().catch(error => {
            console.error('CodePulse: failed to save statistics', error);
        });
    }, saveIntervalMs);

    context.subscriptions.push({
        dispose: () => {
            clearInterval(timer);
            clearInterval(saveTimer);
        }
    });

    console.log('CodePulse activated');
}

export async function deactivate(): Promise<void> {
    const store = activeStore;
    activeStore = undefined;

    if (store) {
        await store.flush();
    }
}

function getDashboardHtml(webview: vscode.Webview): string {

    const nonce = randomBytes(16).toString('hex');

    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">

    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src 'unsafe-inline';
                   script-src 'nonce-${nonce}';">

    <style>
        body {
            padding: 24px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }

        h1 {
            margin-bottom: 24px;
        }

        h2 {
            margin-top: 30px;
        }

        .filters {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 24px;
        }

        select {
            padding: 8px;
            border-radius: 5px;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, #555);
        }

        .summary {
            padding: 20px;
            margin-bottom: 24px;
            border-radius: 10px;
            background: var(--vscode-editorWidget-background);
        }

        .total {
            font-size: 30px;
            font-weight: bold;
        }

        .item {
            margin: 16px 0;
        }

        .row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 7px;
            overflow-wrap: anywhere;
        }

        .track {
            width: 100%;
            height: 14px;
            border-radius: 5px;
            background: var(--vscode-input-background);
            overflow: hidden;
        }

        .bar {
            height: 100%;
            background: #3794ff;
            border-radius: 5px;
        }
    </style>
</head>

<body>

    <h1>CodePulse</h1>

    <div class="filters">
        <select id="period">
            <option value="today">Сегодня</option>
            <option value="week">Последние 7 дней</option>
            <option value="all">Всё время</option>
        </select>

        <select id="project">
            <option value="all">Все проекты</option>
        </select>
    </div>

    <div class="summary">
        <div>Активное время</div>
        <div class="total" id="total">0 мин</div>
    </div>

    <h2>Активность по проектам</h2>
    <div id="projects"></div>

    <h2>Активность по файлам</h2>
    <div id="files"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const periodSelect = document.getElementById('period');
        const projectSelect = document.getElementById('project');

        let statistics = [];

        function formatTime(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const rest = seconds % 60;

            if (hours > 0) {
                return hours + ' ч ' + minutes + ' мин';
            }

            if (minutes > 0) {
                return minutes + ' мин ' + rest + ' сек';
            }

            return rest + ' сек';
        }

        function localDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');

            return year + '-' + month + '-' + day;
        }

        function updateProjectOptions() {
            const selected = projectSelect.value;

            const names = [...new Set(
                statistics.map(item => item.project)
            )].sort();

            projectSelect.replaceChildren();

            const all = document.createElement('option');
            all.value = 'all';
            all.textContent = 'Все проекты';
            projectSelect.appendChild(all);

            for (const name of names) {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                projectSelect.appendChild(option);
            }

            if (names.includes(selected)) {
                projectSelect.value = selected;
            }
        }

        function drawBars(containerId, data) {
            const container = document.getElementById(containerId);
            container.replaceChildren();

            const entries = Object.entries(data)
                .sort((a, b) => b[1] - a[1]);

            if (entries.length === 0) {
                container.textContent = 'Нет статистики';
                return;
            }

            const max = Math.max(1, ...entries.map(item => item[1]));

            for (const [name, seconds] of entries) {
                const item = document.createElement('div');
                item.className = 'item';

                const row = document.createElement('div');
                row.className = 'row';

                const label = document.createElement('span');
                label.textContent = name;

                const time = document.createElement('span');
                time.textContent = formatTime(seconds);

                row.append(label, time);

                const track = document.createElement('div');
                track.className = 'track';

                const bar = document.createElement('div');
                bar.className = 'bar';
                bar.style.width = (seconds / max * 100) + '%';

                track.appendChild(bar);
                item.append(row, track);
                container.appendChild(item);
            }
        }

        function render() {
            const period = periodSelect.value;
            const project = projectSelect.value;

            const today = new Date();
            const todayKey = localDate(today);

            const weekStart = new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - 6
            );

            const weekKey = localDate(weekStart);

            const projects = {};
            const files = {};

            let total = 0;

            for (const item of statistics) {

                if (period === 'today' && item.date !== todayKey) {
                    continue;
                }

                if (period === 'week' && item.date < weekKey) {
                    continue;
                }

                if (project !== 'all' && item.project !== project) {
                    continue;
                }

                total += item.seconds;

                projects[item.project] =
                    (projects[item.project] || 0) + item.seconds;

                files[item.file] =
                    (files[item.file] || 0) + item.seconds;
            }

            document.getElementById('total').textContent =
                formatTime(total);

            drawBars('projects', projects);
            drawBars('files', files);
        }

        window.addEventListener('message', event => {
            const message = event.data;

            if (message.type === 'statistics') {
                statistics = message.data;
                updateProjectOptions();
                render();
            }
        });

        periodSelect.addEventListener('change', render);
        projectSelect.addEventListener('change', render);

        vscode.postMessage({ type: 'ready' });
    </script>

</body>
</html>
    `;
}
