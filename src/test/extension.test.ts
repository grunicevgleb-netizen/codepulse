import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('CodePulse extension', () => {
    test('activates and registers the dashboard command', async () => {
        const extension = vscode.extensions.all.find(
            item => item.packageJSON.name === 'codepulse'
        );

        assert.ok(extension, 'CodePulse extension was not found');
        await extension.activate();

        const commands = await vscode.commands.getCommands(true);
        assert.equal(extension.isActive, true);
        assert.ok(commands.includes('codepulse.openDashboard'));
    });
});
