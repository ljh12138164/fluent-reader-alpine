import * as React from "react"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import intl from "react-intl-universal"
import { FeedProps } from "./feed"
import DefaultCard from "../cards/default-card"
import { RSSItem } from "../../scripts/models/item"
import { FocusZone, List, AnimationClassNames } from "@fluentui/react"
import { useFeedTabStop } from "../utils/hooks/useFeedTabStop"
import { FeedEnd } from "./feed-end"

const CardsFeed: React.FC<FeedProps> = props => {
    const { elementRef, onPagesUpdated } = useFeedTabStop()
    const [width, setWidth] = useState(window.innerWidth)
    const [height, setHeight] = useState(window.innerHeight)
    const observerRef = useRef<ResizeObserver>(null)

    useEffect(() => {
        const mainEl = document.querySelector(".main")
        if (!mainEl) return
        setWidth(mainEl.clientWidth - 40)
        observerRef.current = new ResizeObserver(
            (entries: ResizeObserverEntry[]) => {
                if (entries && entries.length > 0) {
                    const nextW = entries[0].contentRect.width - 40
                    const nextH = window.innerHeight
                    setWidth(prev => (prev !== nextW ? nextW : prev))
                    setHeight(prev => (prev !== nextH ? nextH : prev))
                }
            }
        )
        observerRef.current.observe(mainEl)
        return () => {
            observerRef.current.disconnect()
        }
    }, [])

    const getItemCountForPage = useCallback(() => {
        let elemPerRow = Math.max(1, Math.floor(width / 280))
        let rows = Math.max(1, Math.ceil(height / 304))
        return elemPerRow * rows
    }, [width, height])

    const getPageHeight = useCallback(() => {
        return height + (304 - (height % 304))
    }, [height])

    const flexFixItems = useMemo(() => {
        let elemPerRow = Math.max(1, Math.floor(width / 280))
        let elemLastRow = props.items.length % elemPerRow
        let items = [...props.items]
        for (let i = 0; i < (elemPerRow - elemLastRow) % elemPerRow; i += 1)
            items.push(null)
        return items
    }, [props.items, width])

    const feedId = props.feed._id
    const { sourceMap, filter, shortcuts, markRead, contextMenu, showItem } =
        props

    const onRenderItem = useCallback(
        (item: RSSItem, index: number) =>
            item ? (
                <DefaultCard
                    feedId={feedId}
                    key={item._id}
                    item={item}
                    source={sourceMap[item.source]}
                    filter={filter}
                    shortcuts={shortcuts}
                    markRead={markRead}
                    contextMenu={contextMenu}
                    showItem={showItem}
                />
            ) : (
                <div className="flex-fix" key={"f-" + index}></div>
            ),
        [feedId, sourceMap, filter, shortcuts, markRead, contextMenu, showItem]
    )

    return (
        props.feed.loaded && (
            <FocusZone
                elementRef={elementRef}
                as="div"
                id="refocus"
                className="cards-feed-container"
                data-is-scrollable>
                <List
                    className={AnimationClassNames.slideUpIn10}
                    items={flexFixItems}
                    onRenderCell={onRenderItem}
                    onPagesUpdated={onPagesUpdated}
                    getItemCountForPage={getItemCountForPage}
                    getPageHeight={getPageHeight}
                    ignoreScrollingState
                    usePageCache
                />
                <FeedEnd feed={props.feed} loadMore={props.loadMore} />
                {props.items.length === 0 && (
                    <div className="empty">{intl.get("article.empty")}</div>
                )}
            </FocusZone>
        )
    )
}

export default CardsFeed
