import type {VisualIR,IRNode} from "./visual-ir.js";
export type Framework="react"|"next"|"vue"|"html-tailwind";
export function compileIR(ir:VisualIR,framework:Framework){switch(framework){case"react":case"next":return{"src/App.tsx":renderReact(ir.root)};case"vue":return{"src/App.vue":renderVue(ir.root)};case"html-tailwind":return{"index.html":renderHtml(ir.root)}}}
function attrs(n:IRNode){return n.classes.length?` className="${n.classes.join(" ")}"`:""}
function renderReact(nodes:IRNode[]){const render=(n:IRNode):string=>n.tag==="img"||n.tag==="input"?`<${n.tag}${attrs(n)} />`:`<${n.tag}${attrs(n)}>${n.children.map(render).join("")}</${n.tag}>`;return`export default function App(){return (<main>${nodes.map(render).join("")}</main>);}`}
function renderVue(nodes:IRNode[]){return`<template><main>${nodes.map(n=>`<${n.tag} class="${n.classes.join(" ")}"></${n.tag}>`).join("")}</main></template>`}
function renderHtml(nodes:IRNode[]){return`<!doctype html><html><body>${nodes.map(n=>`<${n.tag} class="${n.classes.join(" ")}"></${n.tag}>`).join("")}</body></html>`}
