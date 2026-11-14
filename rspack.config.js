const rspack = require("@rspack/core")
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin")

/** @type {import('@rspack/core').Configuration} */
module.exports = {
    mode: "production",
    stats: "minimal",
    entry: "./src/index.tsx",
    target: "web",
    devtool: false,
    performance: {
        hints: false,
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".json"],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                loader: "builtin:swc-loader",
                options: {
                    jsc: {
                        parser: {
                            syntax: "typescript",
                            tsx: true,
                        },
                        transform: {
                            react: {
                                runtime: "automatic",
                            },
                        },
                    },
                },
                type: "javascript/auto",
            },
            {
                test: /\.css$/,
                use: [rspack.CssExtractRspackPlugin.loader, "css-loader"],
                type: "javascript/auto",
            },
        ],
    },
    output: {
        path: __dirname + "/dist",
        filename: "index.js",
        clean: false,
    },
    plugins: [
        new NodePolyfillPlugin({
            additionalAliases: ["process", "Buffer"],
        }),
        new rspack.HtmlRspackPlugin({
            template: "./src/index.html",
        }),
        new rspack.CssExtractRspackPlugin({
            filename: "main.css",
        }),
    ],
}
