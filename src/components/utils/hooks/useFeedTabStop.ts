import { useCallback, useRef } from "react"
import { useFocusRects } from "@fluentui/react"

export function useFeedTabStop() {
    const elementRef = useRef<HTMLElement>(null)
    // FocusZone handles navigation but does not enable v8's focus styling.
    useFocusRects(elementRef)
    const onPagesUpdated = useCallback(() => {
        const root = elementRef.current
        // Virtualized cells can mount after FocusZone initializes. Fluent UI v8
        // no longer updates their tab stops from key events outside the zone.
        if (!root) return
        if (!root.querySelector('[data-is-focusable][tabindex="0"]')) {
            const first = root.querySelector<HTMLElement>(
                '[data-is-focusable="true"]'
            )
            if (first) first.tabIndex = 0
        }
    }, [])

    return { elementRef, onPagesUpdated }
}
