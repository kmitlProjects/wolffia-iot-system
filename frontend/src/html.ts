export function $(id: string): HTMLElement {
    const element = document.getElementById(id)
    if (!element) {
        throw new Error(`Missing element: ${id}`)
    }
    return element
}

export function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

export function renderIcon(
    filename: string,
    _label: string,
    className = "ui-icon",
): string {
    return `<img src="/assets/icon/${filename}" class="${className}" alt="" aria-hidden="true">`
}
