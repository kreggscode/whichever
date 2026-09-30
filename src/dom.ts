/** Tiny DOM builder — enough structure for the screens, no framework. */

type Child = Node | string | null | undefined | false;
type Prop = string | number | boolean | undefined | null | ((event: Event) => void);

export const h = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, Prop> = {},
    ...children: Child[]
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === "class") node.className = String(value);
        else if (key === "text") node.textContent = String(value);
        // `onclick`-style props are real listeners; anything else is an attribute.
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value as EventListener);
        else node.setAttribute(key, value === true ? "" : String(value));
    }
    append(node, children);
    return node;
};

const append = (parent: Node, children: Child[]) => {
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(
            typeof child === "string" ? document.createTextNode(child) : child,
        );
    }
};

export const clear = (root: HTMLElement) => {
    while (root.firstChild) root.removeChild(root.firstChild);
};

export const on = <T extends HTMLElement>(
    node: T,
    event: string,
    handler: (event: Event) => void,
): T => {
    node.addEventListener(event, handler);
    return node;
};

export const button = (
    label: string,
    handler: () => void,
    variant: "primary" | "ghost" = "primary",
    disabled = false,
): HTMLButtonElement =>
    on(
        // `disabled: false` is skipped by the builder, so the attribute only
        // appears when there is actually a call in flight.
        h("button", { class: `btn ${variant}`, type: "button", text: label, disabled }),
        "click",
        handler,
    );
