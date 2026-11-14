import * as React from "react"
import { useEffect, useState } from "react"
import intl from "react-intl-universal"

interface TimeProps {
    date: Date
}

let sharedNow = Date.now()
const subscribers = new Set<() => void>()
let sharedTimer: ReturnType<typeof setInterval> | null = null

function subscribeTick(cb: () => void) {
    subscribers.add(cb)
    if (!sharedTimer) {
        sharedTimer = setInterval(() => {
            sharedNow = Date.now()
            subscribers.forEach(fn => fn())
        }, 60000)
    }
    return () => {
        subscribers.delete(cb)
        if (subscribers.size === 0 && sharedTimer) {
            clearInterval(sharedTimer)
            sharedTimer = null
        }
    }
}

function displayTime(past: Date, nowMs: number): string {
    const diff = (nowMs - past.getTime()) / 60000
    if (diff < 1) return intl.get("time.now")
    else if (diff < 60) return Math.floor(diff) + intl.get("time.m")
    else if (diff < 1440) return Math.floor(diff / 60) + intl.get("time.h")
    else return Math.floor(diff / 1440) + intl.get("time.d")
}

const Time: React.FC<TimeProps> = React.memo(({ date }) => {
    const [, setTick] = useState(0)
    useEffect(() => {
        return subscribeTick(() => setTick(t => t + 1))
    }, [])

    return <span className="time">{displayTime(date, sharedNow)}</span>
})

export default Time
