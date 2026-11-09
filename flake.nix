{
  description = "SyncUp dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/566acc07c54dc807f91625bb286cb9b321b5f42a";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        # overlay to match mobile-app/android/gradle-wrapper.properties
        gradleOverlay = final: prev: {
          gradle = final.stdenv.mkDerivation rec {
            pname = "gradle";
            version = "9.0";
            src = final.fetchurl {
              url = "https://services.gradle.org/distributions/gradle-${version}-bin.zip";
              sha256 = "0aq78sx4bgwkknyk5y85q1ykdyf72xk02a9x7w8ii9bc55w3vbcg";
            };
            nativeBuildInputs = [ final.unzip final.makeWrapper ];
            dontBuild = true;
            installPhase = ''
              mkdir -p $out/libexec/gradle
              cp -r . $out/libexec/gradle/
              mkdir -p $out/bin
              makeWrapper $out/libexec/gradle/bin/gradle $out/bin/gradle \
                --set JAVA_HOME ${final.jdk17.home}
            '';
          };
        };

        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          overlays = [ gradleOverlay ];
        };

        patchNodeModules =
          let
            pythonEnv = pkgs.python3.withPackages (_:
              pkgs.fdroidserver.propagatedBuildInputs);
            sitePkgs = "${pkgs.fdroidserver}/lib/python${pkgs.python3.pythonVersion}/site-packages";
          in
          pkgs.writeShellApplication {
            name = "patch-node-modules";
            text = ''
              export PYTHONPATH="${sitePkgs}:''${PYTHONPATH:-}"
              exec ${pythonEnv}/bin/python3 ${./nix/patch-node-modules.py} "$@"
            '';
          };
      in
      {
        packages.patch-node-modules = patchNodeModules;

        devShells.default = pkgs.mkShellNoCC {
          buildInputs = with pkgs; [
            go_1_26
            gotools

            # Node
            nodejs_22
            corepack

            # Java (Android builds)
            jdk17
            gradle

            # F-Droid source-tree prep (called from the F-Droid build).
            patchNodeModules

            # Utilities
            git
            gnumake
            watchman
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            # iOS (darwin-only)
            cocoapods
            xcbeautify
            fastlane
            jq
          ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            # macOS provides clang via Xcode; on Linux we need a C
            # compiler for cgo (gomobile, etc.)
            gcc
          ];

          shellHook = ''
            export JAVA_HOME=${pkgs.jdk17.home}
            export PATH="$JAVA_HOME/bin:$PATH"

            export GOPATH="$HOME/gopath"
            export PATH="$GOPATH/bin:$PATH"

            # Corepack writes shims; point it somewhere writable (nix store is read-only).
            # Limit to yarn so corepack doesn't shadow npm/npx with shims that point at
            # nodejs-slim (corepack's bundled runtime, which doesn't ship npm).
            export COREPACK_HOME="''${COREPACK_HOME:-$HOME/.cache/corepack}"
            mkdir -p "$COREPACK_HOME/bin"
            corepack enable --install-directory "$COREPACK_HOME/bin" yarn 2>/dev/null || true
            export PATH="$COREPACK_HOME/bin:$PATH"

            ${pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
              # macOS only: https://github.com/facebook/react-native/issues/42112
              export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
            ''}

            # Expose Xcode toolchain so gomobile / xcodebuild can find SDKs.
            if [ -z "$DEVELOPER_DIR" ] && [ -d /Applications/Xcode.app ]; then
              export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
            fi

            # Banner goes to stderr so that anything capturing stdout
            # (e.g. `OUT=$(make appdrop-upload)` parsing CLI JSON output)
            # doesn't get polluted by these informational lines.
            >&2 echo ""
            >&2 echo "SyncUp dev shell"
            >&2 echo "  go:   $(go version | cut -d' ' -f3)"
            >&2 echo "  node: $(node --version)"
            >&2 echo "  java: $(java -version 2>&1 | head -1)"
            >&2 echo ""
            >&2 echo "Notes:"
            >&2 echo "  - Xcode must be installed via the App Store (not available in Nix)"
            >&2 echo "  - Android SDK/NDK: install via Android Studio or sdkmanager"
            >&2 echo "  - Run 'make setup' to install gomobile"
            echo ""
          '';
        };
      });
}
