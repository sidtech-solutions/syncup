GO ?= go
GOPATH ?= $(shell $(GO) env GOPATH)
GOROOT ?= $(shell $(GO) env GOROOT)
GOMOBILE ?= $(GOPATH)/bin/gomobile
GOBIND ?= $(GOPATH)/bin/gobind

export GOTOOLCHAIN = go1.26.10

ANDROID_OUTPUT = ../mobile-app/android/app/libs/gobridge.aar
IOS_OUTPUT = ../mobile-app/ios/Frameworks/Gobridge.xcframework

# Fixed path we symlink the backend to before running `gomobile bind`, so the
# absolute source path embedded in libgojni.so is the
# same regardless of where the checkout actually lives (F-Droid's
# /home/vagrant/build/... vs CI's /home/siddarth/.../gh-runners/...).
REPRO_BUILD_DIR = /tmp/syncup-backend-build

# Map ABI names to gomobile targets:
#   arm64-v8a  → android/arm64
#   x86_64     → android/amd64
#   armeabi-v7a→ android/arm
#   x86        → android/386
# Default: arm64 only (covers CI and local dev).
# Release builds pass both: ANDROID_TARGETS=android/arm64,android/amd64
ANDROID_TARGETS ?= android/arm64
ANDROID_API = 23

.PHONY: all setup android ios clean check-go install-gomobile gen-assets ensure-assets

all: android

setup: check-go install-gomobile ensure-assets
	@echo "Setup complete!"

check-go:
	@echo "Checking Go installation..."
	@if ! command -v $(GO) > /dev/null 2>&1; then \
		echo "Error: Go not found. Please install Go 1.25+"; \
		echo "Visit: https://golang.org/dl/"; \
		exit 1; \
	fi
	@echo "Go found: $(shell $(GO) version)"
	@echo "GOROOT: $(GOROOT)"
	@echo "GOPATH: $(GOPATH)"

# Pin gomobile version explicitly to avoid suprises.
# Format: v0.0.0-<UTC yyyymmddhhmmss>-<12-char commit prefix>
# Commit:  https://github.com/golang/mobile/commit/bebd421c7fa8
# To bump: `go list -m -versions golang.org/x/mobile` (latest pseudo-version
# is the last one printed; or pick a specific commit from the GitHub mirror).
GOMOBILE_VERSION = v0.0.0-20260410095206-2cfb76559b7b
GOMOBILE_VERSION = v0.0.0-20260508232728-bebd421c7fa8

install-gomobile:
	@echo "Installing gomobile and gobind ($(GOMOBILE_VERSION))..."
	@$(GO) install golang.org/x/mobile/cmd/gomobile@$(GOMOBILE_VERSION)
	@$(GO) install golang.org/x/mobile/cmd/gobind@$(GOMOBILE_VERSION)
	@echo "Gomobile installed at: $(GOMOBILE)"
	@echo "Gobind installed at: $(GOBIND)"

# The web GUI assets are generated into ./syncthing-fork by ../scripts/gen-assets.sh,
# which stitches the Go module (pruned of vendored libs) together with syncthing's
# git tree at the same commit; go.mod's `replace => ./syncthing-fork` makes the
# build compile them in.
# SYNCTHING_FORK / GUI_ASSETS_FILE are shared with clean + ensure-assets so they
# live here; the reproducibility epoch is owned by the script (only it uses it).
SYNCTHING_FORK = syncthing-fork
GUI_ASSETS_FILE = $(SYNCTHING_FORK)/lib/api/auto/gui.files.go
GEN_ASSETS = ../scripts/gen-assets.sh

gen-assets:
	@GO="$(GO)" SYNCTHING_FORK=$(SYNCTHING_FORK) $(GEN_ASSETS)

ensure-assets:
	@if [ ! -f $(GUI_ASSETS_FILE) ]; then \
		$(MAKE) gen-assets; \
	else \
		echo "GUI assets present ($(GUI_ASSETS_FILE)); run 'make gen-assets' to refresh"; \
	fi

android: setup gen-assets
	@echo "Building Android AAR..."
	@mkdir -p $(dir $(abspath $(ANDROID_OUTPUT)))
	@rm -f $(REPRO_BUILD_DIR)
	@ln -s $(abspath .) $(REPRO_BUILD_DIR)
	@$(GO) get golang.org/x/mobile/bind@$(GOMOBILE_VERSION)
	@cd $(REPRO_BUILD_DIR) && \
		GOPATH=$(GOPATH) PATH=$(GOPATH)/bin:$(GOROOT)/bin:$$PATH GOFLAGS=-trimpath $(GOMOBILE) bind \
			-trimpath \
			-target=$(ANDROID_TARGETS) \
			-androidapi $(ANDROID_API) \
			-ldflags="-buildid= -checklinkname=0" \
			-o $(abspath $(ANDROID_OUTPUT)) \
			./
	@echo "✓ Android AAR built successfully at $(ANDROID_OUTPUT)"

ios: setup gen-assets
	@echo "Building iOS XCFramework..."
	@mkdir -p $(dir $(IOS_OUTPUT))
	@$(GO) get golang.org/x/mobile/bind@$(GOMOBILE_VERSION)
	@GOPATH=$(GOPATH) PATH=$(GOPATH)/bin:$(GOROOT)/bin:$$PATH $(GOMOBILE) bind \
		-target=ios \
		-ldflags=-checklinkname=0 \
		-o $(IOS_OUTPUT) \
		./
	@echo "✓ iOS XCFramework built successfully at $(IOS_OUTPUT)"

clean:
	@echo "Cleaning build artifacts..."
	@rm -f $(ANDROID_OUTPUT)
	@rm -rf $(IOS_OUTPUT)
	@rm -rf $(SYNCTHING_FORK)
	@echo "✓ Clean complete"

clean-all: clean
	@echo "Cleaning all dependencies and cache..."
	@$(GO) clean -modcache
	@echo "✓ Full clean complete"

test: ensure-assets
	@echo "Running tests..."
	@$(GO) test -tags noassets -v ./...

fmt:
	@echo "Formatting code..."
	@$(GO) fmt ./...

vet: ensure-assets
	@echo "Running go vet..."
	@$(GO) vet -tags noassets ./...

help:
	@echo "Available targets:"
	@echo "  make setup        - Install gomobile toolchain + bootstrap GUI assets"
	@echo "  make gen-assets   - Mirror syncthing locally + go-generate bundled GUI assets (always fresh)"
	@echo "  make android      - Build Android AAR"
	@echo "  make ios          - Build iOS XCFramework"
	@echo "  make clean        - Remove build artifacts and the syncthing fork"
	@echo "  make clean-all    - Remove build artifacts and module cache"
	@echo "  make test         - Run Go tests"
	@echo "  make fmt          - Format Go code"
	@echo "  make vet          - Run go vet"
