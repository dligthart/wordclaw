import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
    const nextUrl = new URL("/ui/agent-sandbox/scenarios", url);
    nextUrl.search = url.search;

    throw redirect(307, `${nextUrl.pathname}${nextUrl.search}`);
};
