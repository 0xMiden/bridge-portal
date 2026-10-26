import type { MetadataRoute } from "next";
import { SITE_URL } from "../config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL }];
}
