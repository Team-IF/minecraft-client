import {ForgeVersion, MinecraftVersion} from "./utils/Versions";

import * as path from 'path';

import Downloader from "./utils/Downloader";

import {LibraryManager} from "./utils/Libraries";
import {AssetManager}   from "./utils/Assets";

import {child_process, fs} from 'mz';
import * as mkdirp from 'mkdirp';
import * as nbt from 'nbt';

import {Authentication, AuthenticationResult} from "./utils/Authentication";
import {ForgeVersionDescription, ForgeVersionType} from "./utils/Manifests";
import {CustomForgeMod, CurseForgeMod, ForgeMod} from "./utils/Mods";
import {InstallationProgress} from "./utils/InstallationProgress";

export {Authentication, AuthenticationResult} from "./utils/Authentication";
export {ForgeVersion, MinecraftVersion} from "./utils/Versions";
export {InstallationProgress} from "./utils/InstallationProgress";
export {CurseForgeMod, CustomForgeMod, ForgeMod} from "./utils/Mods";
export {ForgeVersionDescription, ForgeVersionType} from "./utils/Manifests";

export class MinecraftClient {

    version: MinecraftVersion;
    options: ClientOptions;
    forge: ForgeVersion;

    nativeDir: string;

    progress: InstallationProgress;

    libraryManager: LibraryManager;
    assetManager: AssetManager;

    private constructor(version: MinecraftVersion, forge?: ForgeVersion, options: ClientOptions = MinecraftClient.defaultConfig, progress?: InstallationProgress) {
        for(let i in MinecraftClient.defaultConfig)
            if(!options[i])
                options[i] = MinecraftClient.defaultConfig[i];

        this.options = options;

        this.version = version;
        this.forge = forge;

        this.libraryManager = new LibraryManager(options, version);
        this.assetManager   = new AssetManager(options, version);

        this.progress = progress || InstallationProgress.callback();
    }

    private static readonly defaultConfig: ClientOptions = {
        javaExecutable: 'java',
        features: {}
    };

    public static getMinecraftClient(version: string | MinecraftVersion, options: ClientOptions, progress?: InstallationProgress): Promise<MinecraftClient | null> {
        return this.getClient(version, null, options, progress);
    }

    public static getForgeClient(version: string | MinecraftVersion, forge: ForgeVersionType | ForgeVersionDescription, options: ClientOptions, progress?: InstallationProgress): Promise<MinecraftClient | null> {
        return this.getClient(version, forge, options, progress);
    }

    public static async getClient(version: string | MinecraftVersion, forge: ForgeVersionType | ForgeVersionDescription, options: ClientOptions, progress?: InstallationProgress): Promise<MinecraftClient | null> {
        let mcVersion: MinecraftVersion;

        if(typeof version === 'string') {
            mcVersion = <MinecraftVersion>await MinecraftVersion.getVersion(<string>version, options);
        } else {
            mcVersion = <MinecraftVersion>version;
        }

        let forgeVersion: ForgeVersion;
        if(forge) {
            if(forge === "recommended" || forge === "latest")
                forgeVersion = <ForgeVersion>await ForgeVersion.getPromotedVersion(mcVersion, forge);
            else {
                let version: string = forge; //14.23.4.2709
                let build: number; // [14, 23, 4, 2709].reverse() => [2709,4,23,14][0] => 2709

                if(version.indexOf('.') === -1)
                    return null; // failsafe?

                build = parseInt(version.split('\.').reverse()[0]);

                forgeVersion = await ForgeVersion.getCustomVersion(build, version, mcVersion);
            }
        }

        if(!mcVersion)
            return null;

        return new MinecraftClient(mcVersion, forgeVersion, options, progress);
    }

    public async checkInstallation(): Promise<void> {
        this.progress.step("Installing Libraries");
        await this.libraryManager.installMinecraftLibraries(this.progress);
        if(this.forge) {
            this.progress.step("Installing Forge Libraries");
            await this.libraryManager.installForgeLibraries(this.forge, this.progress);
        }
        this.progress.step("Installing Assets");
        await this.assetManager.install(this.progress);
    }

    private async loadServersDat(): Promise<ServersDatItem[]> {
        const serversFilePath = path.join(this.options.gameDir, "servers.dat");

        let serversDat = null;

        try {
            serversDat = fs.readFileSync(serversFilePath);
        } catch (err) {
            return [];
        }

        const data: ServersDatManifest = await (new Promise((res, rej) => {
            nbt.parse(serversDat, (err, data) => err ? rej(err) : res(data))
        }));

        return data.value.servers.value.value;
    }

    private saveServersDat(serversData: ServersDatItem[]) {
        const serversFilePath = path.join(this.options.gameDir, "servers.dat");
        const translatedData = nbt.writeUncompressed({
            name: "", value: {
                servers: {
                    type: "list", value: {
                        type: "compound", value: serversData
                    }
                }
            }
        });

        const bufferedData = Buffer.from(translatedData);
        fs.writeFileSync(serversFilePath, bufferedData);
    }

    public async ensureServersDat(server: ServerInfo) {
        const servers: ServersDatItem[] = await this.loadServersDat();

        const preparedServerHost: string = server.host + (server.port ? (':' + server.port) : '');
        const preparedServer: ServersDatItem = {
            ip: {
                type: "string",
                value: preparedServerHost
            },
            name: {
                type: "string",
                value: server.name || "Server"
            }
        };

        if (!servers.length) {
            return this.saveServersDat([preparedServer]);
        }

        if (!servers.find((item: ServersDatItem) => item.ip.value === preparedServerHost)) {
            return this.saveServersDat([preparedServer, ...servers]);
        }
     }

    public async checkMods(mods: ForgeMod[], exclusive: boolean): Promise<void> {
        this.progress.step("Installing Mods");

        mkdirp(path.join(this.options.gameDir, 'mods'));

        let files: string[];
        if(exclusive && await fs.exists(path.join(this.options.gameDir, 'mods')))
            files = await fs.readdir(path.join(this.options.gameDir, 'mods'));
        else
            files = [];

        files = files.filter(value => value.indexOf('.jar') !== -1);

        for(let i = 0; i < mods.length; i++) {
            let mod: ForgeMod = mods[i];

            this.progress.call(i/mods.length);

            let file: string = path.join(this.options.gameDir, 'mods', mod.file + '.jar');

            if(exclusive) {
                let i: number = files.indexOf(mod.file + '.jar');
                if(i !== -1)
                    files.splice(i, 1);
            }

            if(mod.sha1)
                await Downloader.checkOrDownload(mod.url, mod.sha1, file);
            else
                await Downloader.existsOrDownload(mod.url, file);
        }

        if(exclusive) {
            let task: Promise<void>[] = [];
            for(let i = 0; i < files.length; i++)
                task.push(fs.unlink(path.join(this.options.gameDir, 'mods', files[i])));

            await Promise.all(task);
        }

        this.progress.call(1);
    }

    public async launch(auth: AuthenticationResult, launchOptions: LaunchOptions = {}): Promise<child_process.ChildProcess> {
        this.nativeDir = await this.libraryManager.unpackNatives(this.version);

        const args: string[] = [
            ...this.libraryManager.getJavaArguments(this.nativeDir, launchOptions),
            ...this.libraryManager.getLaunchArguments(auth, launchOptions)
        ];

        let cp: child_process.ChildProcess = child_process.spawn(this.options.javaExecutable, args, {
            cwd: this.options.gameDir
        });

        if(launchOptions.redirectOutput) {
            cp.stdout.pipe(process.stdout);
            cp.stderr.pipe(process.stderr);
        }

        return cp;
    }
}

export declare type ClientOptions = {
    gameDir?: string,
    javaExecutable?: string,
    features?: {
        is_demo_user?: boolean
        has_custom_resolution?: boolean,
        has_custom_server?: boolean
    }
}

export declare type LaunchOptions = {
    redirectOutput?: boolean,
    resolution?: {
        width: number,
        height: number
    },
    server?: {
        host: string,
        port: number
    },
    memory?: string
}

export declare type ServerInfo = {
    host: string,
    port?: number,
    name?: string
}

export type ServersDatItem = {
    ip: {
        type: "string",
        value: string
    },
    name: {
        type: "string",
        value: string
    }
}

export type ServersDatManifest = {
    name: "",
    value: {
        servers: {
            type: "list",
            value: {
                type: "compound",
                value: ServersDatItem[]
            }
        }
    }
}
