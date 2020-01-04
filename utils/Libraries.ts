import {ForgeVersion, MinecraftVersion} from "./Versions";
import {ClientOptions, LaunchOptions} from "../app";
import Downloader from "./Downloader";

import * as unzipper from 'unzipper';
import * as fetch from 'node-fetch';
import * as mkdir from 'mkdirp';
import * as path from 'path';
import * as tmp from './TempHelper';

import {Endpoints, Utils} from "./Constants";
import {
    ForgeLibrary,
    ForgeLibraryManifest,
    MinecraftArtifact,
    MinecraftLibraryManifest,
    Rule,
    Arguments,
    ConditionedValue
} from "./Manifests";
import {AuthenticationResult} from "./Authentication";
import {InstallationProgress} from "./InstallationProgress";

import {fs} from 'mz';

export class LibraryManager {

    public options: ClientOptions;
    public version: MinecraftVersion;

    public mainClass: string;
    public arguments: Arguments;

    public versionType: string;

    public assetIndex: string;

    public classpath: string[];

    constructor(options: ClientOptions, version: MinecraftVersion) {
        this.options = options;
        this.version = version;

        this.classpath = [];

        this.arguments = {
            game: [],
            jvm: []
        };

        this.mainClass = "";

        this.versionType = "";
        this.assetIndex = "";
    }

    public async installMinecraftLibraries(progress: InstallationProgress): Promise<void> {
        let data: MinecraftLibraryManifest = await this.version.getLibraryManifest();

        for(let i = 0; i < data.libraries.length; i++) {
            progress.call(i/data.libraries.length);

            let lib = data.libraries[i];
            if(!LibraryHelper.applyRules(lib.rules, this.options)) {
                continue;
            }

            if(lib.downloads.artifact && !lib.natives) {
                let dest: string = path.join(this.options.gameDir, 'libraries', lib.downloads.artifact.path);
                mkdir(path.join(dest, '..'));
                
                this.classpath.push(path.resolve(dest));

                await Downloader.checkOrDownload(
                    lib.downloads.artifact.url,
                    lib.downloads.artifact.sha1,
                    dest
                );
            }
            if(lib.natives) {
                let classifier: string = lib.natives[Utils.platform];
                let artifact: MinecraftArtifact = lib.downloads.classifiers[classifier];

                if(!artifact || !artifact.path)
                    continue;

                //natives to classpath?

                let p: string = path.join(this.options.gameDir, 'libraries', artifact.path);
                await Downloader.checkOrDownload(
                    artifact.url,
                    artifact.sha1,
                    p
                );
            }
        }
        let client: MinecraftArtifact = data.downloads.client;

        this.classpath.push(path.resolve(`${this.options.gameDir}/versions/${this.version.id}/${this.version.id}.jar`));

        await Downloader.checkOrDownload(client.url, client.sha1, path.join(this.options.gameDir, 'versions', this.version.id, this.version.id + '.jar'));

        progress.call(1);

        this.mainClass = data.mainClass;
        this.arguments = data.arguments;
        this.versionType = data.type;
        this.assetIndex = data.assets;
    }

    public async installForgeLibraries(version: ForgeVersion, progress: InstallationProgress): Promise<void> {
        let data: Buffer;
        let manifest: string = path.join(this.options.gameDir, `versions/${version.mcversion}/${version.mcversion}-forge.json`);
        if(await fs.exists(manifest)) {
            data = await fs.readFile(manifest);
        } else {
            let res: fetch.Response = await fetch.default(version.installer);
            data = await new Promise<Buffer>((accept, reject) => {
                res.body.pipe(unzipper.Parse())
                    .on('entry', async function (entry) {
                        if (entry.path === "install_profile.json") {
                            let data: Buffer = await new Promise<Buffer>(resolve => {
                                let buffers: Buffer[] = [];
                                entry.on('data', (d: Buffer) => buffers.push(d));
                                entry.on('end', () => resolve(<Buffer>Buffer.concat(buffers)));
                            });
                            accept(data);
                        } else {
                            // noinspection JSIgnoredPromiseFromCall
                            entry.autodrain();
                        }
                    })
                    .on('close', () => reject());
            });
            await fs.writeFile(manifest, data);
        }

        let libraries: ForgeLibraryManifest = JSON.parse(data.toString());

        let libs: ForgeLibrary[] = libraries.versionInfo.libraries.filter(value => value.clientreq !== false);;
        for(let i = 0; i < libs.length; i++) {
            let lib = libs[i];
            progress.call(i/libs.length);

            let dest: string = path.join(this.options.gameDir, 'libraries', LibraryHelper.getArtifactPath(lib));
            mkdir(path.join(dest, '..'));

            this.classpath.push(dest);

            let url: string = LibraryHelper.getArtifactUrl(lib);

            try {
                await Downloader.checkOrDownload(url, lib.checksums, dest);
            } catch (e) {
                //Fix bug in typesafe (missing artifacts)...
                try {
                    await Downloader.checkOrDownload(LibraryHelper.getArtifactUrl(lib, true), lib.checksums, dest);
                } catch (ex) {} //Missing artifact
            }
        }
        let sha1: string = (await Downloader.getFile(version.universal + '.sha1')).toString();
        let dest: string = path.join(this.options.gameDir, 'libraries', 'net', 'minecraftforge', 'forge', version.version, `${version.mcversion}-${version.version}`, `forge-${version.mcversion}-${version.version}-universal.jar`);
        mkdir(path.join(dest, '..'));

        this.classpath.push(dest);

        await Downloader.checkOrDownload(version.universal, sha1, dest);
        progress.call(1);
        this.mainClass = libraries.versionInfo.mainClass;
        this.arguments = libraries.versionInfo.arguments;

        this.versionType = 'ignored';
    }

    public async unpackNatives(version: MinecraftVersion): Promise<string> {
        let tmpDir: string = tmp.createTempDir();
        let data: MinecraftLibraryManifest = await version.getLibraryManifest();
        for(let i = 0; i < data.libraries.length; i++) {
            let lib: MinecraftLibrary = data.libraries[i];
            if(!LibraryHelper.applyRules(lib.rules, this.options))
                continue;
            if(!lib.natives)
                continue;
            if(lib.natives[Utils.platform]) {
                let classifier: string = lib.natives[Utils.platform];
                let artifact: MinecraftArtifact = lib.downloads.classifiers[classifier];

                if(!artifact.path)
                    continue;

                let p: string = path.join(this.options.gameDir, 'libraries', artifact.path);
                await Downloader.unpack(p, tmpDir);
            }
        }
        return tmpDir;
    }

    public getClasspath(): string {
        /*let files: string[] = await tmp.tree(path.join(this.options.gameDir, 'libraries'));
        files = files.map(file => path.join('libraries', file));
        files.push(`versions/${this.version.id}/${this.version.id}.jar`);
        return files.join(Utils.classpathSeparator);*/
        return this.classpath.join(Utils.classpathSeparator);
    }

    public getJavaArguments(nativeDir: string, launchOptions: LaunchOptions): string[] {
        let args = this.arguments.jvm
            .filter((item: any) => LibraryHelper.applyRules(item.rules, this.options))
            .map((item: any) => item.value || item)
            .join(' ')

        args = args.replace("${natives_directory}", nativeDir)
        args = args.replace("${launcher_name}", "null") // TODO: Add these params?
        args = args.replace("${launcher_version}", "null") // TODO: Add these params?
        args = args.replace("${classpath}", this.getClasspath())

        if (launchOptions.memory) {
            args = args + ` -Xmx${launchOptions.memory} -Xms${launchOptions.memory}`
        }

        const unreplacedVars = args.match(/\${.*}/)
        if (unreplacedVars) {
            throw new Error(`Unreplaced java variable found "${unreplacedVars[0]}"`)
        }

        return [...args.split(' '), this.mainClass]
    }

    //--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --versionType Forge
    //--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --versionType ${version_type}

    public getLaunchArguments(auth: AuthenticationResult, launchOptions: LaunchOptions): string[] {
        let args = this.arguments.game
            .filter((item: any) => LibraryHelper.applyRules(item.rules, this.options))
            .map((item: any) => item.value || item)
            .join(' ')
            
        args = args.replace("${auth_player_name}", auth.name)
        args = args.replace("${version_name}", this.version.id)
        args = args.replace("${game_directory}", path.resolve(this.options.gameDir))
        args = args.replace("${assets_root}", path.join(this.options.gameDir, 'assets'))
        args = args.replace("${assets_index_name}", this.assetIndex)
        args = args.replace("${auth_uuid}", auth.uuid)
        args = args.replace("${auth_access_token}", auth.token || "null")
        args = args.replace("${user_type}", "mojang")
        args = args.replace("${version_type}", this.versionType)
        args = args.replace("${user_properties}", "{}")

        // Patch missing known arguments
        if (launchOptions.resolution) {
            args += ` --width ${launchOptions.resolution.width} --height ${launchOptions.resolution.height}`
        }

        if (launchOptions.server) {
            args += ` --server ${launchOptions.server.host} --port ${launchOptions.server.port || 25565}`
        }

        const unreplacedVars = args.match(/\${.*}/)
        if (unreplacedVars) {
            throw new Error(`Unreplaced game variable found "${unreplacedVars[0]}"`)
        }

        return args.split(' ')
    }

}

export declare type MinecraftLibrary = {
    name: string,
    downloads: {
        artifact: MinecraftArtifact,
        classifiers?: {
            "natives-osx"?: MinecraftArtifact
            "natives-linux"?: MinecraftArtifact
            "natives-windows"?: MinecraftArtifact
        }
    },
    extract?: {
        exclude?: [string]
    },
    natives?: {
        linux: "natives-linux",
        osx: "natives-osx",
        windows: "natives-windows"
    },
    rules?: [Rule]
}

class LibraryHelper {

    public static applyRules(rules: Rule[], options?: ClientOptions): boolean {
        if(!rules) return true;
        let result: boolean = false;
        for(let i = 0; i < rules.length; i++) {
            let rule = rules[i];
            if(rule.os) {
                if (rule.os.name === Utils.platform)
                    result = rule.action === "allow";
            } else if (rule.features) {
                result = Object.keys(rule.features || {}).filter(key => options.features && options.features[key]).length > 0
            } else {
                result = rule.action === "allow";
            }
        }
        return result;
    }


    public static getArtifactUrl(lib: ForgeLibrary, retry?: boolean): string {
        return (retry ? 'http://central.maven.org/maven2/' : lib.url || Endpoints.MINECRAFT_LIB_SERVER) + this.getArtifactPath(lib);
    }

    public static getArtifactPath(lib: ForgeLibrary): string {
        let parts: string[] = lib.name.split(':');
        let pkg: string = parts[0].replace(/\./g, '/');
        let artifact: string = parts[1];
        let version: string = parts[2];
        return `${pkg}/${artifact}/${version}/${artifact}-${version}.jar`;
    }

}
