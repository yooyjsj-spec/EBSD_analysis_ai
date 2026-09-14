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

export type HistogramBin = {
  bin_start: number;
  bin_end: number;
  count: number;
  area_fraction: number;
};

export type SizeClass = {
  label: string;
  count: number;
  area_fraction: number;
};

export type AnalysisResult = {
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
  };
  histogram: HistogramBin[];
  size_classes: SizeClass[];
  grains: Grain[];
  overlay_png_base64: string;
  notes: string[];
};
