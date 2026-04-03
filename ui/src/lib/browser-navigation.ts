export function reloadCurrentPage() {
    if (typeof window === "undefined") return;
    window.location.reload();
}
