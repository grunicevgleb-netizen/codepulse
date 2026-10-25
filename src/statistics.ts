export type Activity = {
    file: string;
    project: string;
    date: string;
    seconds: number;
};

export type Statistics = Record<string, Activity>;

type SaveStatistics = (statistics: Statistics) => Thenable<void>;

export function getDateKey(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

export class StatisticsStore {
    private dirty = false;
    private saveQueue = Promise.resolve();

    constructor(
        private readonly statistics: Statistics,
        private readonly saveStatistics: SaveStatistics
    ) {}

    values(): Activity[] {
        return Object.values(this.statistics);
    }

    addSecond(file: string, project: string, date = getDateKey()): void {
        const key = JSON.stringify([date, file]);

        if (this.statistics[key] === undefined) {
            this.statistics[key] = {
                file,
                project,
                date,
                seconds: 0
            };
        }

        this.statistics[key].seconds++;
        this.dirty = true;
    }

    flush(): Promise<void> {
        const save = this.saveQueue.then(async () => {
            if (!this.dirty) {
                return;
            }

            this.dirty = false;
            const snapshot = Object.fromEntries(
                Object.entries(this.statistics).map(([key, activity]) => [
                    key,
                    { ...activity }
                ])
            );

            try {
                await this.saveStatistics(snapshot);
            } catch (error) {
                this.dirty = true;
                throw error;
            }
        });

        this.saveQueue = save.catch(() => undefined);
        return save;
    }
}
