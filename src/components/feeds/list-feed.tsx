import * as React from "react"
import { useCallback } from "react"
import intl from "react-intl-universal"
import { FeedProps } from "./feed"
import {
    FocusZone,
    FocusZoneDirection,
    List,
    AnimationClassNames,
} from "@fluentui/react"
import { RSSItem } from "../../scripts/models/item"
import { ViewType } from "../../schema-types"
import ListCard from "../cards/list-card"
import MagazineCard from "../cards/magazine-card"
import CompactCard from "../cards/compact-card"
import { Card } from "../cards/card"
import { useFeedTabStop } from "../utils/hooks/useFeedTabStop"
import { FeedEnd } from "./feed-end"

const ITEMS_PER_PAGE = 20
const COMPACT_ROW_HEIGHT = 32

const ListFeed: React.FC<FeedProps> = props => {
    const { elementRef, onPagesUpdated } = useFeedTabStop()
    const feedId = props.feed._id
    const {
        sourceMap,
        filter,
        viewConfigs,
        shortcuts,
        markRead,
        contextMenu,
        showItem,
        viewType,
        currentItem,
    } = props

    const onRenderItem = useCallback(
        (item: RSSItem) => {
            const cardProps = {
                feedId,
                key: item._id,
                item,
                source: sourceMap[item.source],
                filter,
                viewConfigs,
                shortcuts,
                markRead,
                contextMenu,
                showItem,
                selected:
                    viewType === ViewType.List && currentItem === item._id,
            } as Card.Props

            switch (viewType) {
                case ViewType.Magazine:
                    return <MagazineCard {...cardProps} />
                case ViewType.Compact:
                    return <CompactCard {...cardProps} />
                default:
                    return <ListCard {...cardProps} />
            }
        },
        [
            feedId,
            sourceMap,
            filter,
            viewConfigs,
            shortcuts,
            markRead,
            contextMenu,
            showItem,
            viewType,
            currentItem,
        ]
    )

    const getItemCountForPage = useCallback(() => ITEMS_PER_PAGE, [])
    const getCompactPageHeight = useCallback(
        (
            index: number,
            _visibleRect: unknown,
            itemCount: number,
            items: RSSItem[]
        ) => Math.min(itemCount, items.length - index) * COMPACT_ROW_HEIGHT,
        []
    )

    const getClassName = () => {
        switch (viewType) {
            case ViewType.Magazine:
                return "magazine-feed"
            case ViewType.Compact:
                return "compact-feed"
            default:
                return "list-feed"
        }
    }

    return (
        props.feed.loaded && (
            <FocusZone
                elementRef={elementRef}
                as="div"
                id="refocus"
                direction={FocusZoneDirection.vertical}
                className={getClassName()}
                data-is-scrollable>
                <List
                    className={AnimationClassNames.slideUpIn10}
                    items={props.items}
                    onRenderCell={onRenderItem}
                    onPagesUpdated={onPagesUpdated}
                    getItemCountForPage={getItemCountForPage}
                    getPageHeight={
                        viewType === ViewType.Compact
                            ? getCompactPageHeight
                            : undefined
                    }
                    getKey={(item: RSSItem) => String(item._id)}
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

export default ListFeed
