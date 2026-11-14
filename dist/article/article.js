function get(name) {
    if (name = (new RegExp('[?&]' + encodeURIComponent(name) + '=([^&]*)')).exec(location.search))
        return decodeURIComponent(name[1]);
}
let dir = get("d")
if (dir === "1") {
    document.body.classList.add("rtl")
} else if (dir === "2") {
    document.body.classList.add("vertical")
    document.body.addEventListener("wheel", (evt) => {
        document.scrollingElement.scrollLeft -= evt.deltaY;
    });
}
async function getArticle(url) {
    let article = get("a")
    if (get("m") === "1") {
        return (await Mercury.parse(url, {html: article})).content || ""
    } else {
        return article
    }
}
document.documentElement.style.fontSize = get("s") + "px"
let font = get("f")
if (font) document.body.style.fontFamily = `"${font}"`
let url = get("u")
getArticle(url).then(article => {
    let domParser = new DOMParser()
    let dom = domParser.parseFromString(get("h"), "text/html")
    dom.getElementsByTagName("article")[0].innerHTML = article
    let baseEl = dom.createElement('base')
    baseEl.setAttribute('href', url)
    dom.head.append(baseEl)
    for (let s of dom.getElementsByTagName("script")) {
        s.parentNode.removeChild(s)
    }
    for (let e of dom.querySelectorAll("*[src]")) {
        e.src = e.src
    }
    for (let e of dom.querySelectorAll("*[href]")) {
        e.href = e.href
    }
    let main = document.getElementById("main")
    main.innerHTML = dom.body.innerHTML
    main.classList.add("show")
})

function handleLinkActivate(e) {
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null
    if (!a) return
    const href = a.href
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        e.preventDefault()
        e.stopPropagation()
        const background = e.button === 1 || e.ctrlKey || e.metaKey
        window.parent.postMessage({ type: "fr-open-external", url: href, background }, "*")
    }
}

document.addEventListener("click", handleLinkActivate)
document.addEventListener("auxclick", (e) => {
    if (e.button === 1) handleLinkActivate(e)
})

document.addEventListener("keydown", (e) => {
    let el = document.activeElement
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement
    }
    if (el && (el.matches("input, textarea, select, iframe, frame") || el.isContentEditable)) {
        return
    }
    window.parent.postMessage({
        type: "fr-webview-keydown",
        input: {
            type: "keyDown",
            key: e.key,
            code: e.code,
            shift: e.shiftKey,
            alt: e.altKey,
            control: e.ctrlKey,
            meta: e.metaKey,
            isAutoRepeat: e.repeat
        }
    }, "*")
})

document.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    const selectionText = (window.getSelection() ? window.getSelection().toString() : "")
    const img = e.target && e.target.closest ? e.target.closest("img[src]") : null
    const link = e.target && e.target.closest ? e.target.closest("a[href]") : null
    const imgSrc = img ? img.src : ""
    const linkURL = link ? link.href : ""
    if (imgSrc || selectionText || linkURL) {
        window.parent.postMessage({
            type: "fr-webview-context-menu",
            pos: [e.clientX, e.clientY],
            text: selectionText,
            url: linkURL,
            imgSrc: imgSrc || undefined
        }, "*")
        const dismiss = () => {
            document.removeEventListener("mousedown", dismiss)
            document.removeEventListener("scroll", dismiss)
            window.parent.postMessage({ type: "fr-webview-context-menu" }, "*")
        }
        document.addEventListener("mousedown", dismiss)
        document.addEventListener("scroll", dismiss)
    }
})
