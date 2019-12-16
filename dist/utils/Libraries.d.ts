import { ForgeVersion, MinecraftVersion } from "./Versions";
import { ClientOptions } from "../app";
import { MinecraftArtifact, Rule, Arguments } from "./Manifests";
import { AuthenticationResult } from "./Authentication";
import { InstallationProgress } from "./InstallationProgress";
export declare class LibraryManager {
    options: ClientOptions;
    version: MinecraftVersion;
    mainClass: string;
    arguments: Arguments;
    versionType: string;
    assetIndex: string;
    classpath: string[];
    constructor(options: ClientOptions, version: MinecraftVersion);
    installMinecraftLibraries(progress: InstallationProgress): Promise<void>;
    installForgeLibraries(version: ForgeVersion, progress: InstallationProgress): Promise<void>;
    unpackNatives(version: MinecraftVersion): Promise<string>;
    getClasspath(): string;
    getJavaArguments(nativeDir: string): string[];
    getLaunchArguments(auth: AuthenticationResult): string[];
}
export declare type MinecraftLibrary = {
    name: string;
    downloads: {
        artifact: MinecraftArtifact;
        classifiers?: {
            "natives-osx"?: MinecraftArtifact;
            "natives-linux"?: MinecraftArtifact;
            "natives-windows"?: MinecraftArtifact;
        };
    };
    extract?: {
        exclude?: [string];
    };
    natives?: {
        linux: "natives-linux";
        osx: "natives-osx";
        windows: "natives-windows";
    };
    rules?: [Rule];
};
