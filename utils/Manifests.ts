import {MinecraftLibrary} from "./Libraries";
import {MinecraftVersion} from "./Versions";

export declare type MinecraftVersionType = 'release' | 'snapshot' | 'unknown';
export declare type ForgeVersionType = 'latest' | 'recommended';
export declare type ForgeVersionDescription = string;

export declare type MinecraftVersionManifest = {
    latest: {
        release: string,
        snapshot: string
    },
    versions: [MinecraftVersion]
}
export declare type ForgeVersionManifest = {
    artifact: string,
    homepage: string,
    name: string,
    mcversion: object,
    number: object;
    promos: object,
    webpath: string
}

export declare type Rule = {
    action: 'allow' | 'disallow',
    os?: {
        name: 'osx' | 'linux' | 'windows'
    },
    features?: {
        has_custom_resolution?: boolean,
        is_demo_user?: boolean
    }
}

export declare type ConditionedValue = {
    rules: Rule[],
    value: string | string[]
}

export declare type Arguments = {
    game: (string | ConditionedValue)[],
    jvm: (string | ConditionedValue)[]
}

export declare type MinecraftLibraryManifest = {
    minecraftArguments: string;
    assetIndex: MinecraftArtifact,
    assets: string,
    downloads: {
        client: MinecraftArtifact,
        server: MinecraftArtifact
    },
    id: string,
    libraries: [MinecraftLibrary],
    mainClass: string,
    arguments: Arguments,
    minimumLauncherVersion: number,
    releaseTime: Date,
    time: Date,

    type: 'release' | 'snapshot'
}

export declare type ForgeLibraryManifest = {
    install: {
        profileName: string,
        target: string,
        path: string,
        version: string,
        filePath: string,
        minecraft: string,
        mirrorList: string,
        logo: string,
        welcome: string,
        modlist: string
    },
    versionInfo: {
        id: string,
        time: Date,
        releaseTime: Date,
        type: string,
        mainClass: string,
        arguments: {
            game: string[],
            jvm: string[]
        },
        inheritsFrom: string,
        jar: string
        logging: object,
        libraries: ForgeLibrary[]
    },
    optionals: ForgeLibrary[]
}


export declare type MinecraftArtifact = {
    path?: string,
    sha1: string,
    size: number,
    url: string
}
export declare type ForgeLibrary = {
    name: string,
    url?: string,
    checksums?: [string],
    serverreq?: boolean,
    clientreq?: boolean
}

export declare type MinecraftAssetIndex = {
    objects: object
};

export declare type MinecraftAsset = {
    hash: string,
    size: number
}