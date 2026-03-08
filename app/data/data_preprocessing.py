import geopandas as gpd

gdf = gpd.read_file('2025_Blocks.shp')
gdf.to_file('2025_Block_Shapes.geojson', driver='GeoJSON')