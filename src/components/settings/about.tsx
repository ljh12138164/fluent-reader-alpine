import * as React from "react"
import intl from "react-intl-universal"
import { Stack, Link } from "@fluentui/react"

const AboutTab: React.FC = () => {
    return (
        <div className="tab-body">
            <Stack className="settings-about" horizontalAlign="center">
                <img
                    src="icons/alpine.png"
                    alt="Fluent Reader Alpine"
                    style={{ width: 120, height: 120 }}
                />
                <h3 style={{ fontWeight: 600 }}>Fluent Reader Alpine</h3>
                <small>
                    {intl.get("settings.version")}{" "}
                    {globalThis.utils.getVersion()}
                </small>
                <p className="settings-hint">
                    Lightweight fork of{" "}
                    <Link
                        onClick={() =>
                            globalThis.utils.openExternal(
                                "https://github.com/yang991178/fluent-reader"
                            )
                        }>
                        Fluent Reader
                    </Link>
                    .
                    <br />
                    Copyright © 2020 Haoyuan Liu. All rights reserved.
                </p>
                <Stack
                    horizontal
                    horizontalAlign="center"
                    tokens={{ childrenGap: 12 }}>
                    <small>
                        <Link
                            onClick={() =>
                                globalThis.utils.openExternal(
                                    "https://github.com/yang991178/fluent-reader/wiki/Support#keyboard-shortcuts"
                                )
                            }>
                            {intl.get("settings.shortcuts")}
                        </Link>
                    </small>
                    <small>
                        <Link
                            onClick={() =>
                                globalThis.utils.openExternal(
                                    "https://github.com/ljh12138164/fluent-reader-alpine"
                                )
                            }>
                            {intl.get("settings.openSource")}
                        </Link>
                    </small>
                    <small>
                        <Link
                            onClick={() =>
                                globalThis.utils.openExternal(
                                    "https://github.com/ljh12138164/fluent-reader-alpine/issues"
                                )
                            }>
                            {intl.get("settings.feedback")}
                        </Link>
                    </small>
                </Stack>
            </Stack>
        </div>
    )
}

export default AboutTab
