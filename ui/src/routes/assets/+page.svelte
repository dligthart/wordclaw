<script lang="ts">
    import { onMount } from "svelte";
    import { fetchApi, ApiError } from "$lib/api";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import ActorIdentity from "$lib/components/ActorIdentity.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import { Icon, ArrowPath, Plus, Trash, XMark } from "svelte-hero-icons";

    type AssetAccessMode = "public" | "signed" | "entitled";
    type AssetStatus = "active" | "deleted";
    type EntitlementScopeType = "item" | "type" | "subscription";

    type Asset = {
        id: number;
        filename: string;
        originalFilename: string;
        mimeType: string;
        sizeBytes: number;
        byteHash: string | null;
        storageProvider: string;
        sourceAssetId: number | null;
        variantKey: string | null;
        transformSpec: Record<string, unknown> | null;
        accessMode: AssetAccessMode;
        entitlementScope: {
            type: EntitlementScopeType;
            ref: number | null;
        } | null;
        status: AssetStatus;
        metadata: Record<string, unknown>;
        uploaderActorId: string | null;
        uploaderActorType: string | null;
        uploaderActorSource: string | null;
        createdAt: string;
        updatedAt: string;
        deletedAt: string | null;
        relationships: {
            sourcePath: string | null;
            derivativesPath: string;
        };
        delivery: {
            contentPath: string;
            accessPath: string | null;
            requiresAuth: boolean;
            requiresEntitlement: boolean;
            offersPath: string | null;
            signedTokenTtlSeconds: number | null;
        };
    };

    type AssetOffer = {
        id: number;
        slug: string;
        name: string;
        scopeType: string;
        scopeRef: number | null;
        priceSats: number;
        active: boolean;
    };

    type AssetAccessGrant = {
        mode: "public" | "signed";
        method: "GET";
        contentPath: string;
        auth: "none" | "api-key-or-session";
        signedUrl: string | null;
        token: string | null;
        expiresAt: string | null;
        ttlSeconds: number | null;
        note: string;
    };

    type ReferenceUsage = {
        contentItemId: number;
        contentTypeId: number;
        contentTypeName: string;
        contentTypeSlug: string;
        path: string;
        version: number;
        status?: string;
        contentItemVersionId?: number;
    };

    type ReferenceUsageSummary = {
        activeReferenceCount: number;
        historicalReferenceCount: number;
        activeReferences: ReferenceUsage[];
        historicalReferences: ReferenceUsage[];
    };

    type AssetListMeta = {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
        nextCursor: string | null;
    };

    const PAGE_SIZE = 20;
    const DEFAULT_META: AssetListMeta = {
        total: 0,
        limit: PAGE_SIZE,
        offset: 0,
        hasMore: false,
        nextCursor: null,
    };

    const assetColumns = [
        { key: "name", label: "Asset" },
        { key: "accessMode", label: "Access" },
        { key: "status", label: "Status" },
        { key: "sizeBytes", label: "Size" },
        { key: "updatedAt", label: "Updated" },
    ];

    let assets = $state<Asset[]>([]);
    let selectedAsset = $state<Asset | null>(null);
    let selectedDerivatives = $state<Asset[]>([]);
    let offers = $state<AssetOffer[]>([]);
    let accessGrant = $state<AssetAccessGrant | null>(null);
    let assetUsage = $state<ReferenceUsageSummary | null>(null);
    let meta = $state<AssetListMeta>({ ...DEFAULT_META });

    let loading = $state(true);
    let refreshing = $state(false);
    let loadingInspector = $state(false);
    let loadingDerivatives = $state(false);
    let loadingOffers = $state(false);
    let loadingUsage = $state(false);
    let error = $state<any>(null);

    let search = $state("");
    let accessModeFilter = $state("");
    let statusFilter = $state<"" | AssetStatus>("active");
    let pageOffset = $state(0);

    let showUploadModal = $state(false);
    let uploading = $state(false);
    let uploadError = $state<any>(null);
    let uploadFile = $state<File | null>(null);
    let uploadFilename = $state("");
    let uploadAccessMode = $state<AssetAccessMode>("public");
    let uploadMetadata = $state("");
    let uploadEntitlementType = $state<EntitlementScopeType>("type");
    let uploadEntitlementRef = $state("");
    let uploadSourceAssetId = $state("");
    let uploadVariantKey = $state("");
    let uploadTransformSpec = $state("");

    let issuingAccess = $state(false);

    let currentRangeStart = $derived(assets.length === 0 ? 0 : pageOffset + 1);
    let currentRangeEnd = $derived(
        assets.length === 0 ? 0 : pageOffset + assets.length,
    );
    let hasPrevPage = $derived(pageOffset > 0);
    let hasNextPage = $derived(currentRangeEnd < meta.total);
    let previewUrl = $derived.by(() => {
        if (!selectedAsset || !selectedAsset.mimeType.startsWith("image/")) {
            return null;
        }

        if (selectedAsset.status !== "active") {
            return null;
        }

        if (selectedAsset.accessMode === "public") {
            return selectedAsset.delivery.contentPath;
        }

        if (selectedAsset.accessMode === "signed") {
            return accessGrant?.signedUrl ?? null;
        }

        return null;
    });
    let assetSummaryBadges = $derived.by(() => [
        `${meta.total} matching`,
        statusFilter ? formatStatusLabel(statusFilter) : "All statuses",
        accessModeFilter
            ? `${formatAccessModeLabel(accessModeFilter as AssetAccessMode)} only`
            : "All access modes",
    ]);
    let uploadIsDerivative = $derived(uploadSourceAssetId.trim().length > 0);

    onMount(() => {
        void loadAssets();
    });

    function formatDate(value: string | null) {
        if (!value) return "Unknown";
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) return "Unknown";
        return new Date(value).toLocaleString();
    }

    function formatRelativeDate(value: string | null) {
        if (!value) return "Unknown";
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) return "Unknown";

        const deltaHours = Math.floor((Date.now() - timestamp) / 3_600_000);
        if (deltaHours < 1) return "Just now";
        if (deltaHours < 24) return `${deltaHours}h ago`;

        const deltaDays = Math.floor(deltaHours / 24);
        if (deltaDays < 7) return `${deltaDays}d ago`;

        return new Date(value).toLocaleDateString();
    }

    function formatBytes(bytes: number) {
        if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
        if (bytes < 1024) return `${bytes} B`;

        const units = ["KB", "MB", "GB", "TB"];
        let value = bytes / 1024;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }

        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function formatAccessModeLabel(value: AssetAccessMode) {
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function formatStatusLabel(value: AssetStatus) {
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function assetStatusVariant(
        status: AssetStatus,
    ): "success" | "danger" | "muted" {
        return status === "active" ? "success" : "danger";
    }

    function assetAccessVariant(
        accessMode: AssetAccessMode,
    ): "default" | "warning" | "paid" {
        if (accessMode === "signed") return "warning";
        if (accessMode === "entitled") return "paid";
        return "default";
    }

    function formatEntitlementScope(asset: Asset | null) {
        if (!asset?.entitlementScope) {
            return "Not scoped";
        }

        const label =
            asset.entitlementScope.type === "type"
                ? "Content type"
                : asset.entitlementScope.type === "item"
                  ? "Content item"
                  : "Subscription";

        return asset.entitlementScope.ref
            ? `${label} #${asset.entitlementScope.ref}`
            : label;
    }

    function assetLabel(asset: Asset) {
        return asset.originalFilename || asset.filename;
    }

    function derivativeLabel(asset: Asset) {
        return asset.variantKey ? `${asset.variantKey} variant` : "Derivative";
    }

    function openUrl(url: string) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    function openSelectedAssetContent() {
        if (!selectedAsset) return;

        if (selectedAsset.accessMode === "public") {
            openUrl(selectedAsset.delivery.contentPath);
            return;
        }

        if (selectedAsset.accessMode === "signed" && accessGrant?.signedUrl) {
            openUrl(accessGrant.signedUrl);
        }
    }

    function resetUploadForm() {
        uploadFile = null;
        uploadFilename = "";
        uploadAccessMode = "public";
        uploadMetadata = "";
        uploadEntitlementType = "type";
        uploadEntitlementRef = "";
        uploadSourceAssetId = "";
        uploadVariantKey = "";
        uploadTransformSpec = "";
        uploadError = null;
    }

    function openUploadModal() {
        resetUploadForm();
        showUploadModal = true;
    }

    function openDerivativeModal(asset: Asset) {
        resetUploadForm();
        uploadSourceAssetId = String(asset.id);
        uploadAccessMode = asset.accessMode;
        if (asset.entitlementScope) {
            uploadEntitlementType = asset.entitlementScope.type;
            uploadEntitlementRef = asset.entitlementScope.ref
                ? String(asset.entitlementScope.ref)
                : "";
        }
        showUploadModal = true;
    }

    function closeUploadModal() {
        if (uploading) return;
        showUploadModal = false;
        resetUploadForm();
    }

    function handleUploadFileChange(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        uploadFile = file;

        if (file && !uploadFilename.trim()) {
            uploadFilename = file.name;
        }
    }

    function showErrorToast(title: string, err: unknown) {
        const message =
            err instanceof Error ? err.message : "An unexpected error occurred.";
        const apiError = err instanceof ApiError ? err : null;
        feedbackStore.pushToast({
            severity: "error",
            title,
            message,
            code: apiError?.code,
            remediation: apiError?.remediation,
        });
    }

    async function loadAssetOffers(id: number) {
        loadingOffers = true;
        try {
            const response = await fetchApi(`/assets/${id}/offers`);
            offers = response.data ?? [];
        } catch (err) {
            offers = [];
            showErrorToast("Failed to load offers", err);
        } finally {
            loadingOffers = false;
        }
    }

    async function loadAssetDerivatives(
        id: number,
        status: AssetStatus = "active",
    ) {
        loadingDerivatives = true;
        try {
            const params = new URLSearchParams();
            params.set("status", status);
            const response = await fetchApi(
                `/assets/${id}/derivatives?${params.toString()}`,
            );
            selectedDerivatives = response.data ?? [];
        } catch (err) {
            selectedDerivatives = [];
            showErrorToast("Failed to load derivative assets", err);
        } finally {
            loadingDerivatives = false;
        }
    }

    async function loadAssetUsage(id: number) {
        loadingUsage = true;
        try {
            const response = await fetchApi(`/assets/${id}/used-by`);
            assetUsage = response.data ?? null;
        } catch (err) {
            assetUsage = null;
            showErrorToast("Failed to load asset usage", err);
        } finally {
            loadingUsage = false;
        }
    }

    async function loadAssetDetails(id: number, silent = false) {
        if (!silent) {
            loadingInspector = true;
        }

        try {
            const response = await fetchApi(`/assets/${id}`);
            selectedAsset = response.data;
            accessGrant = null;
            assetUsage = null;
            const followUps: Promise<void>[] = [
                loadAssetUsage(id),
                loadAssetDerivatives(
                    selectedAsset?.sourceAssetId ?? id,
                    selectedAsset?.status ?? "active",
                ),
            ];
            if (selectedAsset?.accessMode === "entitled") {
                followUps.push(loadAssetOffers(id));
            } else {
                offers = [];
            }
            await Promise.all(followUps);
        } catch (err) {
            assetUsage = null;
            showErrorToast("Failed to load asset", err);
        } finally {
            loadingInspector = false;
        }
    }

    async function loadAssets(preferredId: number | null = selectedAsset?.id ?? null) {
        if (loading) {
            refreshing = false;
        } else {
            refreshing = true;
        }

        error = null;
        try {
            const params = new URLSearchParams();
            if (search.trim()) params.set("q", search.trim());
            if (accessModeFilter) params.set("accessMode", accessModeFilter);
            if (statusFilter) params.set("status", statusFilter);
            params.set("limit", String(PAGE_SIZE));
            params.set("offset", String(pageOffset));

            const response = await fetchApi(`/assets?${params.toString()}`);
            const nextAssets = (response.data ?? []) as Asset[];
            const nextMeta = {
                total: Number(response.meta?.total ?? nextAssets.length),
                limit: Number(response.meta?.limit ?? PAGE_SIZE),
                offset: Number(response.meta?.offset ?? pageOffset),
                hasMore: Boolean(response.meta?.hasMore),
                nextCursor:
                    typeof response.meta?.nextCursor === "string"
                        ? response.meta.nextCursor
                        : null,
            } satisfies AssetListMeta;

            if (
                nextAssets.length === 0 &&
                nextMeta.total > 0 &&
                nextMeta.offset > 0
            ) {
                pageOffset = Math.max(0, nextMeta.offset - PAGE_SIZE);
                await loadAssets(preferredId);
                return;
            }

            assets = nextAssets;
            meta = nextMeta;
            pageOffset = nextMeta.offset;

            const currentSelectedId = selectedAsset?.id ?? null;
            const selectedId =
                preferredId && assets.some((asset) => asset.id === preferredId)
                    ? preferredId
                    : currentSelectedId &&
                        assets.some((asset) => asset.id === currentSelectedId)
                      ? currentSelectedId
                      : assets[0]?.id ?? null;

            if (selectedId) {
                await loadAssetDetails(selectedId, true);
            } else {
                selectedAsset = null;
                accessGrant = null;
                offers = [];
                selectedDerivatives = [];
                assetUsage = null;
            }
        } catch (err) {
            error = err;
            assets = [];
            selectedAsset = null;
            offers = [];
            selectedDerivatives = [];
            accessGrant = null;
            assetUsage = null;
        } finally {
            loading = false;
            refreshing = false;
        }
    }

    async function applyFilters() {
        pageOffset = 0;
        await loadAssets();
    }

    async function resetFilters() {
        search = "";
        accessModeFilter = "";
        statusFilter = "active";
        pageOffset = 0;
        await loadAssets();
    }

    async function goToPreviousPage() {
        if (!hasPrevPage) return;
        pageOffset = Math.max(0, pageOffset - PAGE_SIZE);
        await loadAssets();
    }

    async function goToNextPage() {
        if (!hasNextPage) return;
        pageOffset += PAGE_SIZE;
        await loadAssets();
    }

    async function createAssetUpload() {
        if (!uploadFile) {
            uploadError = new Error("Choose a file to upload.");
            return;
        }

        let metadata: Record<string, unknown> | undefined;
        if (uploadMetadata.trim()) {
            try {
                const parsed = JSON.parse(uploadMetadata);
                if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                ) {
                    throw new Error("not-object");
                }
                metadata = parsed as Record<string, unknown>;
            } catch {
                uploadError = new Error(
                    "Metadata must be valid JSON object text.",
                );
                return;
            }
        }

        let transformSpec: Record<string, unknown> | undefined;
        if (uploadTransformSpec.trim()) {
            try {
                const parsed = JSON.parse(uploadTransformSpec);
                if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                ) {
                    throw new Error("not-object");
                }
                transformSpec = parsed as Record<string, unknown>;
            } catch {
                uploadError = new Error(
                    "Transform spec must be valid JSON object text.",
                );
                return;
            }
        }

        let sourceAssetId: number | undefined;
        if (uploadSourceAssetId.trim()) {
            const parsed = Number(uploadSourceAssetId);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                uploadError = new Error(
                    "Source asset ID must be a positive integer.",
                );
                return;
            }
            sourceAssetId = parsed;
        }

        if (sourceAssetId && !uploadVariantKey.trim()) {
            uploadError = new Error(
                "Variant key is required when creating a derivative asset.",
            );
            return;
        }

        const form = new FormData();
        form.set("file", uploadFile, uploadFile.name);
        if (uploadFilename.trim()) {
            form.set("filename", uploadFilename.trim());
        }
        form.set("accessMode", uploadAccessMode);
        if (metadata) {
            form.set("metadata", JSON.stringify(metadata));
        }
        if (sourceAssetId) {
            form.set("sourceAssetId", String(sourceAssetId));
            form.set("variantKey", uploadVariantKey.trim());
        }
        if (transformSpec) {
            form.set("transformSpec", JSON.stringify(transformSpec));
        }

        if (uploadAccessMode === "entitled") {
            const scope: { type: EntitlementScopeType; ref?: number } = {
                type: uploadEntitlementType,
            };

            if (uploadEntitlementRef.trim()) {
                const ref = Number(uploadEntitlementRef);
                if (!Number.isInteger(ref) || ref <= 0) {
                    uploadError = new Error(
                        "Entitlement reference must be a positive integer.",
                    );
                    return;
                }
                scope.ref = ref;
            }

            form.set("entitlementScope", JSON.stringify(scope));
        }

        uploading = true;
        uploadError = null;

        try {
            const response = await fetchApi("/assets", {
                method: "POST",
                body: form,
            });

            feedbackStore.pushToast({
                severity: "success",
                title: "Asset uploaded",
                message: `${response.data.originalFilename} is now available in this domain.`,
            });

            showUploadModal = false;
            resetUploadForm();
            pageOffset = 0;
            if (statusFilter === "deleted") {
                statusFilter = "active";
            }
            await loadAssets(response.data.id);
        } catch (err) {
            uploadError = err;
        } finally {
            uploading = false;
        }
    }

    function promptDeleteAsset(asset: Asset) {
        feedbackStore.openConfirm({
            title: "Delete asset",
            message:
                "This soft-deletes the asset so it cannot be newly referenced. Existing history is preserved and you can still restore it later.",
            confirmLabel: "Delete asset",
            confirmIntent: "danger",
            onConfirm: async () => {
                try {
                    await fetchApi(`/assets/${asset.id}`, {
                        method: "DELETE",
                    });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Asset deleted",
                        message: `${assetLabel(asset)} was moved out of the active catalog.`,
                    });
                    await loadAssets();
                } catch (err) {
                    showErrorToast("Failed to delete asset", err);
                    throw err;
                }
            },
        });
    }

    function promptRestoreAsset(asset: Asset) {
        feedbackStore.openConfirm({
            title: "Restore asset",
            message:
                "This restores the asset to the active catalog so it can be referenced again.",
            confirmLabel: "Restore asset",
            confirmIntent: "primary",
            onConfirm: async () => {
                try {
                    await fetchApi(`/assets/${asset.id}/restore`, {
                        method: "POST",
                    });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Asset restored",
                        message: `${assetLabel(asset)} is active again.`,
                    });
                    await loadAssets(asset.id);
                } catch (err) {
                    showErrorToast("Failed to restore asset", err);
                    throw err;
                }
            },
        });
    }

    function promptPurgeAsset(asset: Asset) {
        feedbackStore.openConfirm({
            title: "Purge asset permanently",
            message:
                "This removes the asset bytes and metadata from storage. Only do this once you are sure historical references are no longer needed.",
            confirmLabel: "Purge permanently",
            confirmIntent: "danger",
            onConfirm: async () => {
                try {
                    const response = await fetchApi(`/assets/${asset.id}/purge`, {
                        method: "POST",
                    });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Asset purged",
                        message: `${assetLabel(asset)} was permanently removed. Active refs: ${response.data.referenceSummary.activeReferenceCount}, historical refs: ${response.data.referenceSummary.historicalReferenceCount}.`,
                    });
                    await loadAssets();
                } catch (err) {
                    showErrorToast("Failed to purge asset", err);
                    throw err;
                }
            },
        });
    }

    async function issueSignedAccess() {
        if (!selectedAsset || selectedAsset.accessMode !== "signed") return;

        issuingAccess = true;
        try {
            const response = await fetchApi(`/assets/${selectedAsset.id}/access`, {
                method: "POST",
                body: JSON.stringify({ ttlSeconds: 300 }),
            });

            accessGrant = response.data.access;
            feedbackStore.pushToast({
                severity: "success",
                title: "Signed access ready",
                message:
                    "A 5 minute signed link has been issued for this asset.",
            });
        } catch (err) {
            showErrorToast("Failed to issue signed access", err);
        } finally {
            issuingAccess = false;
        }
    }

    async function copySignedUrl() {
        const url = accessGrant?.signedUrl;
        if (!url) return;

        await navigator.clipboard.writeText(url);
        feedbackStore.pushToast({
            severity: "success",
            title: "Signed URL copied",
            message: "The signed access URL is on your clipboard.",
        });
    }
</script>

<svelte:head>
    <title>Assets | WordClaw Supervisor</title>
</svelte:head>

{#if showUploadModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
        <div class="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
            <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <div>
                    <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        New asset
                    </p>
                    <h3 class="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                        Upload media to this domain
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Upload once, then attach the asset to schema-aware content references.
                    </p>
                </div>
                <Button variant="ghost" size="icon" onclick={closeUploadModal}>
                    <Icon src={XMark} class="h-5 w-5" />
                </Button>
            </div>

            <div class="space-y-5 px-6 py-5">
                {#if uploadError}
                    <ErrorBanner error={uploadError} title="Upload failed" />
                {/if}

                <div class="space-y-2">
                    <label for="upload-file" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                        File
                    </label>
                    <input
                        id="upload-file"
                        type="file"
                        class="block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:file:bg-slate-100 dark:file:text-slate-950 dark:hover:file:bg-white"
                        onchange={handleUploadFileChange}
                    />
                    {#if uploadFile}
                        <p class="text-xs text-slate-500 dark:text-slate-400">
                            {uploadFile.name} · {formatBytes(uploadFile.size)} · {uploadFile.type || "Unknown MIME"}
                        </p>
                    {/if}
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                    <div class="space-y-2">
                        <label for="upload-filename" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Asset name
                        </label>
                        <Input
                            id="upload-filename"
                            bind:value={uploadFilename}
                            placeholder="hero-image.png"
                        />
                    </div>
                    <div class="space-y-2">
                        <label for="upload-access-mode" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Access mode
                        </label>
                        <Select id="upload-access-mode" bind:value={uploadAccessMode}>
                            <option value="public">Public</option>
                            <option value="signed">Signed</option>
                            <option value="entitled">Entitled</option>
                        </Select>
                    </div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p class="text-sm font-medium text-slate-900 dark:text-white">
                                Derivative settings
                            </p>
                            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Optional. Link this upload to an existing source asset to create a managed variant.
                            </p>
                        </div>
                        {#if uploadIsDerivative}
                            <Badge variant="info">Derivative</Badge>
                        {:else}
                            <Badge variant="outline">Standalone</Badge>
                        {/if}
                    </div>

                    <div class="mt-4 grid gap-4 md:grid-cols-2">
                        <div class="space-y-2">
                            <label for="upload-source-asset-id" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Source asset ID
                            </label>
                            <Input
                                id="upload-source-asset-id"
                                bind:value={uploadSourceAssetId}
                                type="number"
                                min="1"
                                placeholder="Optional asset ID"
                            />
                        </div>
                        <div class="space-y-2">
                            <label for="upload-variant-key" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Variant key
                            </label>
                            <Input
                                id="upload-variant-key"
                                bind:value={uploadVariantKey}
                                placeholder="hero-webp"
                                disabled={!uploadIsDerivative}
                            />
                        </div>
                    </div>

                    <div class="mt-4 space-y-2">
                        <label for="upload-transform-spec" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Transform spec JSON
                        </label>
                        <Textarea
                            id="upload-transform-spec"
                            bind:value={uploadTransformSpec}
                            rows={4}
                            placeholder={'{"width":1200,"height":675,"format":"webp"}'}
                            disabled={!uploadIsDerivative}
                        />
                    </div>
                </div>

                {#if uploadAccessMode === "entitled"}
                    <div class="grid gap-4 md:grid-cols-2">
                        <div class="space-y-2">
                            <label for="upload-entitlement-type" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Entitlement scope type
                            </label>
                            <Select id="upload-entitlement-type" bind:value={uploadEntitlementType}>
                                <option value="type">Content type</option>
                                <option value="item">Content item</option>
                                <option value="subscription">Subscription</option>
                            </Select>
                        </div>
                        <div class="space-y-2">
                            <label for="upload-entitlement-ref" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                                Scope reference
                            </label>
                            <Input
                                id="upload-entitlement-ref"
                                bind:value={uploadEntitlementRef}
                                type="number"
                                min="1"
                                placeholder="Optional numeric ID"
                            />
                        </div>
                    </div>
                {/if}

                <div class="space-y-2">
                    <label for="upload-metadata" class="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Metadata JSON
                    </label>
                    <Textarea
                        id="upload-metadata"
                        bind:value={uploadMetadata}
                        rows={6}
                        placeholder={
                            '{"alt":"Product hero","origin":"campaign-2026"}'
                        }
                    />
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                        Optional metadata object stored with the asset and available to agents.
                    </p>
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                <Button variant="outline" onclick={closeUploadModal} disabled={uploading}>
                    Cancel
                </Button>
                <Button onclick={createAssetUpload} disabled={uploading}>
                    {#if uploading}
                        <LoadingSpinner size="sm" color="white" />
                    {/if}
                    Upload asset
                </Button>
            </div>
        </div>
    </div>
{/if}

<div class="flex h-full flex-col gap-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Assets
            </h2>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Upload, inspect, and control the lifecycle of schema-aware media across this domain.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
                {#each assetSummaryBadges as badge}
                    <Badge variant="outline">{badge}</Badge>
                {/each}
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
            <Button variant="outline" onclick={() => void loadAssets()}>
                {#if refreshing}
                    <LoadingSpinner size="sm" />
                {:else}
                    <Icon src={ArrowPath} class="h-4 w-4" />
                {/if}
                Refresh
            </Button>
            <Button onclick={openUploadModal}>
                <Icon src={Plus} class="h-4 w-4" />
                Upload asset
            </Button>
        </div>
    </div>

    {#if error}
        <ErrorBanner
            error={error}
            title="Error loading assets"
            actionLabel="Retry"
            onAction={() => void loadAssets()}
        />
    {/if}

    <Surface>
        <form
            class="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_220px_220px_auto_auto]"
            onsubmit={(event) => {
                event.preventDefault();
                void applyFilters();
            }}
        >
            <div class="space-y-2">
                <label for="asset-search" class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Search assets
                </label>
                <Input
                    id="asset-search"
                    bind:value={search}
                    placeholder="Search by filename, original name, or metadata"
                />
            </div>

            <div class="space-y-2">
                <label for="asset-access-filter" class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Access mode
                </label>
                <Select id="asset-access-filter" bind:value={accessModeFilter}>
                    <option value="">All access modes</option>
                    <option value="public">Public</option>
                    <option value="signed">Signed</option>
                    <option value="entitled">Entitled</option>
                </Select>
            </div>

            <div class="space-y-2">
                <label for="asset-status-filter" class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Status
                </label>
                <Select id="asset-status-filter" bind:value={statusFilter}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="deleted">Deleted</option>
                </Select>
            </div>

            <div class="flex items-end">
                <Button type="submit" class="w-full">Apply filters</Button>
            </div>

            <div class="flex items-end">
                <Button
                    type="button"
                    variant="outline"
                    class="w-full"
                    onclick={() => void resetFilters()}
                >
                    Reset
                </Button>
            </div>
        </form>
    </Surface>

    {#if loading}
        <Surface class="flex min-h-[20rem] items-center justify-center">
            <div class="flex flex-col items-center gap-3 text-center">
                <LoadingSpinner size="xl" />
                <p class="text-sm text-slate-500 dark:text-slate-400">
                    Loading asset inventory…
                </p>
            </div>
        </Surface>
    {:else}
        <div class="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,24rem)]">
            <Surface padded={false} class="overflow-hidden">
                <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Asset inventory
                    </p>
                    <div class="mt-2 flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                                {meta.total} assets in scope
                            </h3>
                            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Select an asset to inspect access, delivery, and lifecycle state.
                            </p>
                        </div>
                        <Badge variant="muted">
                            Showing {currentRangeStart}-{currentRangeEnd}
                        </Badge>
                    </div>
                </div>

                <div class="p-5">
                    <DataTable
                        columns={assetColumns}
                        data={assets}
                        keyField="id"
                        onRowClick={(row) => void loadAssetDetails(row.id)}
                    >
                        {#snippet cell({ row, column })}
                            {@const asset = row as Asset}
                            {#if column.key === "name"}
                                <div class="min-w-0 space-y-1">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="truncate font-semibold text-slate-900 dark:text-white">
                                            {assetLabel(asset)}
                                        </span>
                                        {#if selectedAsset?.id === asset.id}
                                            <Badge variant="info">Selected</Badge>
                                        {/if}
                                    </div>
                                    <p class="truncate text-xs text-slate-500 dark:text-slate-400">
                                        #{asset.id} · {asset.mimeType}
                                    </p>
                                    {#if asset.sourceAssetId}
                                        <p class="truncate text-xs text-slate-500 dark:text-slate-400">
                                            {derivativeLabel(asset)} · source #{asset.sourceAssetId}
                                        </p>
                                    {/if}
                                </div>
                            {:else if column.key === "accessMode"}
                                <Badge variant={assetAccessVariant(asset.accessMode)}>
                                    {formatAccessModeLabel(asset.accessMode)}
                                </Badge>
                            {:else if column.key === "status"}
                                <Badge variant={assetStatusVariant(asset.status)}>
                                    {formatStatusLabel(asset.status)}
                                </Badge>
                            {:else if column.key === "sizeBytes"}
                                <span class="text-slate-600 dark:text-slate-300">
                                    {formatBytes(asset.sizeBytes)}
                                </span>
                            {:else if column.key === "updatedAt"}
                                <div class="space-y-1 text-slate-600 dark:text-slate-300">
                                    <div>{formatRelativeDate(asset.updatedAt)}</div>
                                    <div class="text-xs text-slate-500 dark:text-slate-400">
                                        {formatDate(asset.updatedAt)}
                                    </div>
                                </div>
                            {/if}
                        {/snippet}

                        {#snippet empty()}
                            No assets match the current filters.
                        {/snippet}
                    </DataTable>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
                    <p class="text-sm text-slate-500 dark:text-slate-400">
                        Showing {currentRangeStart}-{currentRangeEnd} of {meta.total}
                    </p>
                    <div class="flex items-center gap-3">
                        <Button
                            variant="outline"
                            disabled={!hasPrevPage}
                            onclick={() => void goToPreviousPage()}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            disabled={!hasNextPage}
                            onclick={() => void goToNextPage()}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            </Surface>

            <div class="space-y-5">
                {#if selectedAsset}
                    <Surface>
                        <div class="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Inspector
                                </p>
                                <h3 class="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                                    {assetLabel(selectedAsset)}
                                </h3>
                                <p class="mt-1 break-all text-sm text-slate-500 dark:text-slate-400">
                                    {selectedAsset.filename}
                                </p>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <Badge variant={assetAccessVariant(selectedAsset.accessMode)}>
                                    {formatAccessModeLabel(selectedAsset.accessMode)}
                                </Badge>
                                <Badge variant={assetStatusVariant(selectedAsset.status)}>
                                    {formatStatusLabel(selectedAsset.status)}
                                </Badge>
                            </div>
                        </div>

                        <div class="mt-5 grid gap-3 sm:grid-cols-2">
                            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Storage
                                </p>
                                <p class="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
                                    {selectedAsset.storageProvider}
                                </p>
                                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    {formatBytes(selectedAsset.sizeBytes)} · {selectedAsset.mimeType}
                                </p>
                            </div>

                            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Lifecycle
                                </p>
                                <p class="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
                                    {selectedAsset.deletedAt
                                        ? `Deleted ${formatRelativeDate(selectedAsset.deletedAt)}`
                                        : `Updated ${formatRelativeDate(selectedAsset.updatedAt)}`}
                                </p>
                                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    Created {formatDate(selectedAsset.createdAt)}
                                </p>
                            </div>
                        </div>

                        <div class="mt-5 flex flex-wrap gap-3">
                            {#if selectedAsset.status === "active"}
                                <Button
                                    variant="outline"
                                    onclick={() =>
                                        selectedAsset &&
                                        openDerivativeModal(selectedAsset)}
                                >
                                    <Icon src={Plus} class="h-4 w-4" />
                                    Create derivative
                                </Button>
                            {/if}
                            {#if selectedAsset.status === "active"}
                                <Button
                                    variant="destructive"
                                    onclick={() =>
                                        selectedAsset &&
                                        promptDeleteAsset(selectedAsset)}
                                >
                                    <Icon src={Trash} class="h-4 w-4" />
                                    Delete
                                </Button>
                            {:else}
                                <Button
                                    variant="outline"
                                    onclick={() =>
                                        selectedAsset &&
                                        promptRestoreAsset(selectedAsset)}
                                >
                                    <Icon src={ArrowPath} class="h-4 w-4" />
                                    Restore
                                </Button>
                            {/if}

                            {#if selectedAsset.accessMode === "public"}
                                <Button
                                    variant="outline"
                                    onclick={openSelectedAssetContent}
                                >
                                    Open content
                                </Button>
                            {/if}

                            {#if selectedAsset.accessMode === "signed"}
                                <Button
                                    variant="outline"
                                    onclick={() => void issueSignedAccess()}
                                    disabled={issuingAccess || selectedAsset.status !== "active"}
                                >
                                    {#if issuingAccess}
                                        <LoadingSpinner size="sm" />
                                    {/if}
                                    Issue signed link
                                </Button>
                                {#if accessGrant?.signedUrl}
                                    <Button variant="outline" onclick={openSelectedAssetContent}>
                                        Open signed content
                                    </Button>
                                {/if}
                            {/if}

                            <Button
                                variant="ghost"
                                onclick={() =>
                                    selectedAsset &&
                                    promptPurgeAsset(selectedAsset)}
                            >
                                Purge permanently
                            </Button>
                        </div>
                    </Surface>

                    <Surface>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Asset family
                                </p>
                                <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                    Inspect the source asset relationship and any derivative variants linked to this record.
                                </p>
                            </div>
                            <Badge variant="outline">
                                {selectedDerivatives.length} variants
                            </Badge>
                        </div>

                        <div class="mt-4 space-y-4">
                            <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Source asset
                                </p>
                                {#if selectedAsset.sourceAssetId}
                                    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <p class="text-sm font-medium text-slate-900 dark:text-white">
                                                Asset #{selectedAsset.sourceAssetId}
                                            </p>
                                            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                This asset is stored as the {selectedAsset.variantKey ?? "linked"} variant of its source record.
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            onclick={() =>
                                                selectedAsset?.sourceAssetId &&
                                                loadAssetDetails(selectedAsset.sourceAssetId)}
                                        >
                                            View source
                                        </Button>
                                    </div>
                                {:else}
                                    <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                        This asset is the source record for its derivative family.
                                    </p>
                                {/if}
                            </div>

                            {#if selectedAsset.variantKey || selectedAsset.transformSpec}
                                <div class="grid gap-3 sm:grid-cols-2">
                                    <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                            Variant key
                                        </p>
                                        <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                            {selectedAsset.variantKey ?? "Not set"}
                                        </p>
                                    </div>
                                    <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                            Transform metadata
                                        </p>
                                        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                            {selectedAsset.transformSpec
                                                ? "Recorded on this derivative asset."
                                                : "No transform metadata recorded."}
                                        </p>
                                    </div>
                                </div>
                            {/if}

                            {#if loadingDerivatives}
                                <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <LoadingSpinner size="sm" />
                                    <p class="text-sm text-slate-500 dark:text-slate-400">
                                        Loading derivative variants…
                                    </p>
                                </div>
                            {:else if selectedDerivatives.length > 0}
                                <div class="space-y-3">
                                    {#each selectedDerivatives as derivative}
                                        <button
                                            class="w-full rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-left transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                                            type="button"
                                            onclick={() => void loadAssetDetails(derivative.id)}
                                        >
                                            <div class="flex flex-wrap items-start justify-between gap-3">
                                                <div class="min-w-0">
                                                    <p class="truncate text-sm font-medium text-slate-900 dark:text-white">
                                                        {assetLabel(derivative)}
                                                    </p>
                                                    <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                        #{derivative.id} · {derivative.variantKey ?? "variant"} · {derivative.mimeType}
                                                    </p>
                                                </div>
                                                <div class="flex flex-wrap items-center gap-2">
                                                    <Badge variant={assetAccessVariant(derivative.accessMode)}>
                                                        {formatAccessModeLabel(derivative.accessMode)}
                                                    </Badge>
                                                    <Badge variant={assetStatusVariant(derivative.status)}>
                                                        {formatStatusLabel(derivative.status)}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </button>
                                    {/each}
                                </div>
                            {:else}
                                <p class="text-sm text-slate-500 dark:text-slate-400">
                                    No derivative variants are currently stored for this asset.
                                </p>
                            {/if}
                        </div>
                    </Surface>

                    <Surface>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Used by
                                </p>
                                <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                    Review current and historical content references before replacing or purging this asset.
                                </p>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">
                                    {assetUsage?.activeReferenceCount ?? 0} active
                                </Badge>
                                <Badge variant="outline">
                                    {assetUsage?.historicalReferenceCount ?? 0} historical
                                </Badge>
                            </div>
                        </div>

                        <div class="mt-4 space-y-4">
                            {#if loadingUsage}
                                <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <LoadingSpinner size="sm" />
                                    <p class="text-sm text-slate-500 dark:text-slate-400">
                                        Loading usage references…
                                    </p>
                                </div>
                            {:else if assetUsage}
                                <div class="grid gap-3 sm:grid-cols-2">
                                    <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                            Active references
                                        </p>
                                        {#if assetUsage.activeReferences.length > 0}
                                            <div class="mt-3 space-y-3">
                                                {#each assetUsage.activeReferences.slice(0, 5) as reference}
                                                    <div class="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-950/40">
                                                        <p class="text-sm font-medium text-slate-900 dark:text-white">
                                                            {reference.contentTypeName} #{reference.contentItemId}
                                                        </p>
                                                        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                            {reference.contentTypeSlug} · {reference.path} · v{reference.version}{reference.status ? ` · ${reference.status}` : ""}
                                                        </p>
                                                    </div>
                                                {/each}
                                            </div>
                                        {:else}
                                            <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                                No active content items currently reference this asset.
                                            </p>
                                        {/if}
                                    </div>

                                    <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                            Historical references
                                        </p>
                                        {#if assetUsage.historicalReferences.length > 0}
                                            <div class="mt-3 space-y-3">
                                                {#each assetUsage.historicalReferences.slice(0, 5) as reference}
                                                    <div class="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-950/40">
                                                        <p class="text-sm font-medium text-slate-900 dark:text-white">
                                                            {reference.contentTypeName} #{reference.contentItemId}
                                                        </p>
                                                        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                            {reference.contentTypeSlug} · {reference.path} · v{reference.version}
                                                        </p>
                                                    </div>
                                                {/each}
                                            </div>
                                        {:else}
                                            <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                                No historical version snapshots reference this asset.
                                            </p>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <p class="text-sm text-slate-500 dark:text-slate-400">
                                    Usage data is not available for this asset.
                                </p>
                            {/if}
                        </div>
                    </Surface>

                    <Surface>
                        <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            Delivery
                        </p>
                        <div class="mt-4 space-y-4">
                            <div class="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                        Content path
                                    </p>
                                    <code class="mt-2 block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                        {selectedAsset.delivery.contentPath}
                                    </code>
                                </div>
                                <div>
                                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                        Access path
                                    </p>
                                    <code class="mt-2 block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                        {selectedAsset.delivery.accessPath ?? "Not required"}
                                    </code>
                                </div>
                            </div>

                            <div class="grid gap-3 sm:grid-cols-2">
                                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                        Entitlement scope
                                    </p>
                                    <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {formatEntitlementScope(selectedAsset)}
                                    </p>
                                </div>
                                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                        Read rules
                                    </p>
                                    <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {selectedAsset.delivery.requiresEntitlement
                                            ? "Offer-backed entitlement required"
                                            : selectedAsset.delivery.requiresAuth
                                              ? "Session or API key required"
                                              : "No runtime auth required"}
                                    </p>
                                </div>
                            </div>

                            {#if selectedAsset.accessMode === "signed"}
                                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <div class="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                                Signed delivery
                                            </p>
                                            <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                                Issue a short-lived access URL before opening or embedding the bytes.
                                            </p>
                                        </div>
                                        <Badge variant="warning">
                                            {selectedAsset.delivery.signedTokenTtlSeconds
                                                ? `${selectedAsset.delivery.signedTokenTtlSeconds}s default TTL`
                                                : "Token issued on demand"}
                                        </Badge>
                                    </div>

                                    {#if accessGrant}
                                        <div class="mt-4 space-y-3">
                                            <code class="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                                                {accessGrant.signedUrl}
                                            </code>
                                            <div class="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                                                <span>Expires {formatDate(accessGrant.expiresAt)}</span>
                                                <span>·</span>
                                                <span>{accessGrant.ttlSeconds}s TTL</span>
                                            </div>
                                            <div class="flex flex-wrap gap-2">
                                                <Button variant="outline" onclick={copySignedUrl}>
                                                    Copy signed URL
                                                </Button>
                                                <Button variant="outline" onclick={openSelectedAssetContent}>
                                                    Open signed content
                                                </Button>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            {/if}

                            {#if selectedAsset.accessMode === "entitled"}
                                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                                Eligible offers
                                            </p>
                                            <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                                Agents must purchase or present a matching entitlement before reading asset bytes.
                                            </p>
                                        </div>
                                        {#if loadingOffers}
                                            <LoadingSpinner size="sm" />
                                        {:else}
                                            <Badge variant="outline">{offers.length} offers</Badge>
                                        {/if}
                                    </div>

                                    {#if offers.length > 0}
                                        <div class="mt-4 space-y-3">
                                            {#each offers as offer}
                                                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950/60">
                                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                                        <div>
                                                            <p class="font-medium text-slate-900 dark:text-white">
                                                                {offer.name}
                                                            </p>
                                                            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                                {offer.scopeType}
                                                                {#if offer.scopeRef}
                                                                    · #{offer.scopeRef}
                                                                {/if}
                                                                · {offer.slug}
                                                            </p>
                                                        </div>
                                                        <div class="flex flex-wrap items-center gap-2">
                                                            <Badge variant={offer.active ? "success" : "muted"}>
                                                                {offer.active ? "Active" : "Inactive"}
                                                            </Badge>
                                                            <Badge variant="paid">
                                                                {offer.priceSats} sats
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    {:else if !loadingOffers}
                                        <p class="mt-4 text-sm text-slate-500 dark:text-slate-400">
                                            No active offers are currently mapped to this entitlement scope.
                                        </p>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    </Surface>

                    {#if previewUrl}
                        <Surface>
                            <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Preview
                            </p>
                            <img
                                class="mt-4 max-h-80 w-full rounded-2xl border border-slate-200 object-contain dark:border-slate-700"
                                src={previewUrl}
                                alt={assetLabel(selectedAsset)}
                            />
                        </Surface>
                    {/if}

                    <Surface>
                        <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            Provenance
                        </p>
                        <div class="mt-4 grid gap-4">
                            <div>
                                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Uploaded by
                                </p>
                                <ActorIdentity
                                    class="mt-3"
                                    actorId={selectedAsset.uploaderActorId}
                                    actorType={selectedAsset.uploaderActorType}
                                    actorSource={selectedAsset.uploaderActorSource}
                                />
                            </div>

                            <div class="grid gap-3 sm:grid-cols-2">
                                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                        Created
                                    </p>
                                    <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {formatDate(selectedAsset.createdAt)}
                                    </p>
                                </div>
                                <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                                    <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                        Byte hash
                                    </p>
                                    <p class="mt-2 break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                                        {selectedAsset.byteHash ?? "Not available"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </Surface>

                    <Surface>
                        <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            Metadata
                        </p>
                        <div class="mt-4">
                            <JsonCodeBlock
                                value={
                                    Object.keys(selectedAsset.metadata ?? {}).length > 0
                                        ? selectedAsset.metadata
                                        : { note: "No metadata recorded for this asset." }
                                }
                                label="Asset metadata"
                                copyable={true}
                            />
                        </div>
                    </Surface>

                    {#if selectedAsset.transformSpec}
                        <Surface>
                            <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Transform spec
                            </p>
                            <div class="mt-4">
                                <JsonCodeBlock
                                    value={selectedAsset.transformSpec}
                                    label="Derivative transform"
                                    copyable={true}
                                />
                            </div>
                        </Surface>
                    {/if}
                {:else}
                    <Surface class="min-h-[20rem]">
                        <div class="flex h-full flex-col items-center justify-center text-center">
                            {#if loadingInspector}
                                <LoadingSpinner size="lg" />
                            {/if}
                            <h3 class="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                                Select an asset
                            </h3>
                            <p class="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                                Choose an asset from the inventory to inspect its delivery policy, lifecycle, and metadata.
                            </p>
                        </div>
                    </Surface>
                {/if}
            </div>
        </div>
    {/if}
</div>
