import * as assert from 'node:assert/strict';
import {
    getDateKey,
    StatisticsStore,
    type Statistics
} from '../statistics';

suite('CodePulse statistics', () => {
    test('counts time separately for files and days', () => {
        const store = new StatisticsStore({}, async () => undefined);

        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-24');
        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-24');
        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-25');
        store.addSecond('C:\\project\\tool.py', 'project', '2026-10-25');

        assert.deepEqual(
            store.values().map(item => item.seconds).sort(),
            [1, 1, 2]
        );
    });

    test('loads saved statistics and continues counting', () => {
        const key = JSON.stringify(['2026-10-25', 'C:\\project\\main.cpp']);
        const saved: Statistics = {
            [key]: {
                file: 'C:\\project\\main.cpp',
                project: 'project',
                date: '2026-10-25',
                seconds: 15
            }
        };
        const store = new StatisticsStore(saved, async () => undefined);

        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-25');

        assert.equal(store.values()[0].seconds, 16);
    });

    test('keeps changes in memory until flush', async () => {
        const saves: Statistics[] = [];
        const store = new StatisticsStore({}, async statistics => {
            saves.push(statistics);
        });

        for (let second = 0; second < 10; second++) {
            store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-25');
        }

        assert.equal(saves.length, 0);
        await store.flush();
        assert.equal(saves.length, 1);
        assert.equal(Object.values(saves[0])[0].seconds, 10);

        await store.flush();
        assert.equal(saves.length, 1, 'clean state must not be saved twice');
    });

    test('does not mutate a snapshot after it has been saved', async () => {
        const saves: Statistics[] = [];
        const store = new StatisticsStore({}, async statistics => {
            saves.push(statistics);
        });

        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-25');
        await store.flush();
        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-25');

        assert.equal(Object.values(saves[0])[0].seconds, 1);
        assert.equal(store.values()[0].seconds, 2);
    });

    test('keeps unsaved changes when persistence fails', async () => {
        let attempts = 0;
        const store = new StatisticsStore({}, async () => {
            attempts++;
            if (attempts === 1) {
                throw new Error('temporary failure');
            }
        });

        store.addSecond('C:\\project\\main.cpp', 'project', '2026-10-25');
        await assert.rejects(store.flush(), /temporary failure/);
        await store.flush();

        assert.equal(attempts, 2);
    });

    test('uses a local calendar date as the key', () => {
        const date = new Date(2026, 9, 25, 23, 30);
        assert.equal(getDateKey(date), '2026-10-25');
    });
});
