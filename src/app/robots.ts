import type { MetadataRoute } from "next";
import { SITE_URL } from "../config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Let crawlers read activity pages' noindex tags and public preview assets.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/health"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
