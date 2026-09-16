export type HistogramBin = {
  bin_start: number;
  bin_end: number;
  count: number;
  area_fraction: number;
};

export type SizeClass = {
  label: string;
  count?: number;
  area_fraction: number;
};

export type Grain = {
  id: number;
  area_px: number;
  area: number;
  ecd: number;
  area_fraction: number;
  touches_edge: boolean;
  centroid_x: number;
  centroid_y: number;
};

export type IpfResult = {
  kind?: "ipf";
  summary: {
    grain_count: number;
    edge_grain_count: number;
    mean_ecd: number;
    median_ecd: number;
    d10: number;
    d50: number;
    d90: number;
    astm_g: number | null;
    unit: "µm" | "px";
    image_width: number;
    image_height: number;
    scale_um_per_px: number | null;
    analyzed_area_fraction: number;
    method: string;
    min_grain_px: number;
    exclude_edge: boolean;
    texture_index?: number;
  };
  histogram: HistogramBin[];
  size_classes: SizeClass[];
  texture?: SizeClass[];
  grains: Grain[];
  overlay_png_base64: string;
  notes: string[];
};

export type SemResult = {
  kind: "sem";
  summary: {
    grain_count: number;
    trace_count: number;
    trace_density: number;
    density_unit: string;
    contrast: number;
    substructure: number;
    anisotropy: number;
    unit: "µm" | "px";
    image_width: number;
    image_height: number;
    scale_um_per_px: number | null;
    method: string;
  };
  texture: { label: string; fraction: number }[];
  grains: Grain[];
  overlay_png_base64: string;
  notes: string[];
};

export type KamResult = {
  kind: "kam";
  summary: {
    mean_kam_deg: number;
    median_kam_deg: number;
    recrystallized_fraction: number;
    recovered_fraction: number;
    deformed_fraction: number;
    gnd_density: number | null;
    gnd_unit: string;
    max_kam_deg: number;
    image_width: number;
    image_height: number;
    scale_um_per_px: number | null;
    method: string;
  };
  histogram: HistogramBin[];
  classes: SizeClass[];
  overlay_png_base64: string;
  notes: string[];
};

export type FractureResult = {
  kind: "fracture";
  summary: {
    facet_count: number;
    median_ecd: number;
    mean_ecd: number;
    p10: number;
    p90: number;
    dominant_angle: string;
    unit: "µm" | "px";
    image_width: number;
    image_height: number;
    scale_um_per_px: number | null;
    method: string;
  };
  histogram: HistogramBin[];
  texture: { label: string; fraction: number }[];
  facets: { rank: number; ecd: number }[];
  report_csv: string;
  overlay_png_base64: string;
  notes: string[];
};
