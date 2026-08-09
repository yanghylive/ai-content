"use client";

import React from "react";

export function LocalhostOriginNormalizer() {
    React.useEffect(() => {
        if (window.location.hostname !== "127.0.0.1") {
            return;
        }
        const nextUrl = new URL(window.location.href);
        nextUrl.hostname = "localhost";
        window.location.replace(nextUrl.toString());
    }, []);

    return null;
}
