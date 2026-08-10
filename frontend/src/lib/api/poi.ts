"use client";

import { api } from "./client";

/** 门店 POI（P1 前端接入 2026-08-10，对标炼刀 /poi） */
export interface PoiStore {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  category?: string | null;
  poiId?: string | null;
  lng?: number | null;
  lat?: number | null;
  tags?: string | null;
  status: string;
  note?: string | null;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PoiReport {
  total: number;
  byCity: Array<{ city: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  totalVisits: number;
}

export interface PoiListResult {
  rows: PoiStore[];
  total: number;
  page: number;
  pageSize: number;
}

export const poiApi = {
  list(params: { city?: string; category?: string; status?: string; keyword?: string } = {}) {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<PoiListResult>(`/poi${q ? `?${q}` : ""}`);
  },
  report() {
    return api.get<PoiReport>("/poi/report");
  },
  create(input: {
    name: string;
    address?: string;
    city?: string;
    category?: string;
    lng?: number;
    lat?: number;
    tags?: string;
    note?: string;
  }) {
    return api.post<PoiStore>("/poi", input);
  },
  update(id: string, input: Partial<{ name: string; address: string; city: string; category: string; lng: number; lat: number; tags: string; note: string }>) {
    return api.patch<PoiStore>(`/poi/${encodeURIComponent(id)}`, input);
  },
  remove(id: string) {
    return api.delete<{ ok: boolean }>(`/poi/${encodeURIComponent(id)}`);
  },
};
