from __future__ import annotations

from datetime import timedelta, timezone
from math import isclose
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.shapes import Drawing, Line, String
from reportlab.lib import colors
from reportlab.lib.colors import HexColor

try:
    IST_TIMEZONE = ZoneInfo("Asia/Kolkata")
except ZoneInfoNotFoundError:
    IST_TIMEZONE = timezone(timedelta(hours=5, minutes=30), name="IST")


# Handle to ist.

def _to_ist(value):
    if value.tzinfo is None:
        utc_value = value.replace(tzinfo=timezone.utc)
    else:
        utc_value = value.astimezone(timezone.utc)
    return utc_value.astimezone(IST_TIMEZONE)


# Handle series values.

def _series_values(rows, attr: str) -> list[float]:
    values: list[float] = []
    for row in rows:
        value = getattr(row, attr, None)
        values.append(0.0 if value is None else float(value))
    return values


# Handle nice bounds.

def _nice_bounds(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 1.0
    low = min(values)
    high = max(values)
    if low == high:
        pad = max(1.0, abs(low) * 0.1)
        return low - pad, high + pad
    span = high - low
    pad = span * 0.1
    return low - pad, high + pad


# Build time labels.

def _build_time_labels(rows: list) -> list[str]:
    labels = [_to_ist(row.recorded_at).strftime("%H:%M") for row in rows]
    tick_every = max(1, len(labels) // 8)
    return [label if idx % tick_every == 0 or idx == len(labels) - 1 else "" for idx, label in enumerate(labels)]


# Add chart title and legend.

def _add_chart_title_and_legend(
    drawing: Drawing,
    *,
    title: str,
    width: int,
    height: int,
    left_pad: int,
    chart_width: int,
    series: list[tuple[str, str, str]],
) -> None:
    drawing.add(
        String(
            left_pad,
            height - 16,
            title,
            fontName="Helvetica-Bold",
            fontSize=8,
            fillColor=colors.HexColor("#0f172a"),
        )
    )
    drawing.add(
        String(
            left_pad + (chart_width / 2.0) - 28,
            8,
            "Time (HH:mm)",
            fontName="Helvetica",
            fontSize=6,
            fillColor=colors.HexColor("#475569"),
        )
    )

    legend_x = left_pad
    legend_y = height - 28
    max_x = left_pad + chart_width
    for _attr, label, color in series:
        item_width = max(74, int(len(label) * 4.3) + 22)
        if legend_x + item_width > max_x:
            legend_x = left_pad
            legend_y -= 10
        drawing.add(
            Line(
                legend_x,
                legend_y + 2,
                legend_x + 12,
                legend_y + 2,
                strokeColor=HexColor(color),
                strokeWidth=1.7,
            )
        )
        drawing.add(
            String(
                legend_x + 15,
                legend_y,
                label,
                fontName="Helvetica",
                fontSize=6,
                fillColor=colors.HexColor("#334155"),
            )
        )
        legend_x += item_width


# Handle configure common axes.

def _configure_common_axes(chart: HorizontalLineChart, labels: list[str]) -> None:
    chart.categoryAxis.categoryNames = labels
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 6
    chart.categoryAxis.labels.angle = 24
    chart.categoryAxis.labels.fillColor = colors.HexColor("#475569")
    chart.categoryAxis.strokeColor = colors.HexColor("#94a3b8")

    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 6
    chart.valueAxis.labels.fillColor = colors.HexColor("#475569")
    chart.valueAxis.labelTextFormat = "%.1f"
    chart.valueAxis.strokeColor = colors.HexColor("#94a3b8")
    chart.valueAxis.visibleGrid = True
    chart.valueAxis.gridStrokeColor = colors.HexColor("#e2e8f0")
    chart.valueAxis.gridStrokeWidth = 0.4


# Build line chart.

def _build_line_chart(
    rows,
    title: str,
    series: list[tuple[str, str, str]],
    width: int = 540,
    height: int = 210,
    y_axis_label: str | None = None,
) -> Drawing:
    drawing = Drawing(width, height)
    left_pad = 40
    right_pad = 18
    bottom_pad = 32
    title_band = 42

    chart_width = max(120, width - left_pad - right_pad)
    chart_height = max(70, height - bottom_pad - title_band)

    chart = HorizontalLineChart()
    chart.x = left_pad
    chart.y = bottom_pad
    chart.width = chart_width
    chart.height = chart_height
    chart.joinedLines = 1
    chart.lines.strokeWidth = 1.5

    data = [_series_values(rows, attr) for attr, _label, _color in series]
    chart.data = data
    for index, (_attr, _label, color) in enumerate(series):
        chart.lines[index].strokeColor = HexColor(color)
        chart.lines[index].symbol = None

    labels = _build_time_labels(rows)
    _configure_common_axes(chart, labels)

    all_vals = [v for series_vals in data for v in series_vals]
    low, high = _nice_bounds(all_vals)
    chart.valueAxis.valueMin = low
    chart.valueAxis.valueMax = high
    chart.valueAxis.valueStep = max((high - low) / 5.0, 0.1)

    drawing.add(chart)
    _add_chart_title_and_legend(
        drawing,
        title=title,
        width=width,
        height=height,
        left_pad=left_pad,
        chart_width=chart_width,
        series=series,
    )
    if y_axis_label:
        drawing.add(
            String(
                left_pad,
                height - 38,
                y_axis_label,
                fontName="Helvetica",
                fontSize=6,
                fillColor=colors.HexColor("#475569"),
            )
        )

    return drawing


# Build dual axis line chart.

def _build_dual_axis_line_chart(
    rows,
    title: str,
    left_series: list[tuple[str, str, str]],
    right_series: list[tuple[str, str, str]],
    width: int = 540,
    height: int = 210,
    left_axis_label: str = "",
    right_axis_label: str = "",
) -> Drawing:
    drawing = Drawing(width, height)
    left_pad = 42
    right_pad = 44
    bottom_pad = 32
    title_band = 42

    chart_width = max(120, width - left_pad - right_pad)
    chart_height = max(70, height - bottom_pad - title_band)

    chart = HorizontalLineChart()
    chart.x = left_pad
    chart.y = bottom_pad
    chart.width = chart_width
    chart.height = chart_height
    chart.joinedLines = 1
    chart.lines.strokeWidth = 1.5

    left_data = [_series_values(rows, attr) for attr, _label, _color in left_series]
    right_data = [_series_values(rows, attr) for attr, _label, _color in right_series]

    left_vals = [v for vals in left_data for v in vals]
    right_vals = [v for vals in right_data for v in vals]
    left_low, left_high = _nice_bounds(left_vals)
    right_low, right_high = _nice_bounds(right_vals)

    left_span = left_high - left_low
    right_span = right_high - right_low
    if isclose(left_span, 0.0):
        left_span = 1.0
        left_high = left_low + left_span
    if isclose(right_span, 0.0):
        right_span = 1.0
        right_high = right_low + right_span

    scaled_right_data = [
        [left_low + ((value - right_low) / right_span) * left_span for value in vals]
        for vals in right_data
    ]
    chart.data = [*left_data, *scaled_right_data]

    series = [*left_series, *right_series]
    for index, (_attr, _label, color) in enumerate(series):
        chart.lines[index].strokeColor = HexColor(color)
        chart.lines[index].symbol = None

    labels = _build_time_labels(rows)
    _configure_common_axes(chart, labels)
    chart.valueAxis.valueMin = left_low
    chart.valueAxis.valueMax = left_high
    chart.valueAxis.valueStep = max((left_high - left_low) / 5.0, 0.1)

    drawing.add(chart)

    axis_x = chart.x + chart.width
    drawing.add(
        Line(
            axis_x,
            chart.y,
            axis_x,
            chart.y + chart.height,
            strokeColor=colors.HexColor("#94a3b8"),
            strokeWidth=0.8,
        )
    )
    tick_count = 5
    for idx in range(tick_count + 1):
        frac = idx / tick_count
        y = chart.y + (frac * chart.height)
        val = right_low + (frac * (right_high - right_low))
        drawing.add(
            Line(
                axis_x,
                y,
                axis_x + 3,
                y,
                strokeColor=colors.HexColor("#94a3b8"),
                strokeWidth=0.8,
            )
        )
        drawing.add(
            String(
                axis_x + 5,
                y - 2,
                f"{val:.1f}",
                fontName="Helvetica",
                fontSize=6,
                fillColor=colors.HexColor("#475569"),
            )
        )

    _add_chart_title_and_legend(
        drawing,
        title=title,
        width=width,
        height=height,
        left_pad=left_pad,
        chart_width=chart_width,
        series=series,
    )

    if left_axis_label:
        drawing.add(
            String(
                left_pad,
                height - 38,
                f"Left Axis: {left_axis_label}",
                fontName="Helvetica",
                fontSize=6,
                fillColor=colors.HexColor("#475569"),
            )
        )
    if right_axis_label:
        drawing.add(
            String(
                axis_x - 65,
                height - 38,
                f"Right Axis: {right_axis_label}",
                fontName="Helvetica",
                fontSize=6,
                fillColor=colors.HexColor("#475569"),
            )
        )

    return drawing


# Handle generate plc graph images.

def generate_plc_graph_images(
    plc_rows: list,
    width: int = 540,
    height: int = 210,
) -> list[tuple[str, Drawing]]:
    if not plc_rows:
        return []

    rows = sorted(plc_rows, key=lambda item: item.recorded_at)

    charts: list[tuple[str, Drawing]] = [
        (
            "Temperature Trends",
            _build_line_chart(
                rows,
                "Temperature Trends",
                [
                    ("ambient_temp", "Ambient Temp", "#2563EB"),
                    ("humidity", "Humidity", "#14B8A6"),
                    ("conditioner_temp", "Conditioner Temp", "#F97316"),
                    ("bagging_temp", "Bagging Temp", "#8B5CF6"),
                ],
                width=width,
                height=height,
                y_axis_label="Temperature / Humidity",
            ),
        ),
        (
            "Pressure Trends",
            _build_line_chart(
                rows,
                "Pressure Trends",
                [
                    ("pressure_before", "Pressure Before", "#0EA5E9"),
                    ("pressure_after", "Pressure After", "#EF4444"),
                ],
                width=width,
                height=height,
                y_axis_label="Pressure",
            ),
        ),
        (
            "Pellet Feeder Speed vs Load",
            _build_dual_axis_line_chart(
                rows,
                "Pellet Feeder Speed vs Load",
                left_series=[("pellet_feeder_speed", "Feeder Speed", "#0D9488")],
                right_series=[("pellet_motor_load", "Feeder Load (Amp)", "#7C3AED")],
                width=width,
                height=height,
                left_axis_label="Speed",
                right_axis_label="Load (Amp)",
            ),
        ),
    ]

    return charts
