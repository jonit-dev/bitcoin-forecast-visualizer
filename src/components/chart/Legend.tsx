import type { LegendData } from './types';

interface ChartLegendProps {
  data: LegendData | null;
}

function formatPrice(value: number | undefined) {
  return value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PriceValue({ value, isUp }: { value: number | undefined; isUp: boolean }) {
  return (
    <span className={isUp ? 'text-emerald-400' : 'text-red-400'}>
      {formatPrice(value)}
    </span>
  );
}

export function ChartLegend({ data }: ChartLegendProps) {
  if (!data) return null;

  const isUp = (data.close ?? 0) >= (data.open ?? 0);

  return (
    <div className="absolute bottom-8 left-3 z-10 pointer-events-none flex flex-wrap gap-x-3 gap-y-1 text-[10px] md:text-xs font-mono bg-zinc-950/50 backdrop-blur-sm p-1.5 rounded border border-white/5">
      <div className="text-zinc-300 font-sans font-medium mr-1">{data.time}</div>

      {data.isForecast && (
        <div className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded text-[9px] uppercase tracking-wider font-sans font-semibold flex items-center">
          Forecast
        </div>
      )}

      {data.open !== undefined && (
        <div className="flex gap-1">
          <span className="text-zinc-500">O</span>
          <PriceValue value={data.open} isUp={isUp} />
        </div>
      )}
      {data.high !== undefined && (
        <div className="flex gap-1">
          <span className="text-zinc-500">H</span>
          <PriceValue value={data.high} isUp={isUp} />
        </div>
      )}
      {data.low !== undefined && (
        <div className="flex gap-1">
          <span className="text-zinc-500">L</span>
          <PriceValue value={data.low} isUp={isUp} />
        </div>
      )}
      {data.close !== undefined && (
        <div className="flex gap-1">
          <span className="text-zinc-500">C</span>
          <PriceValue value={data.close} isUp={isUp} />
        </div>
      )}
      {data.upper !== undefined && (
        <div className="flex gap-1 ml-2">
          <span className="text-zinc-500">Upper</span>
          <span className="text-emerald-400/70">
            {formatPrice(data.upper)}
          </span>
        </div>
      )}
      {data.lower !== undefined && (
        <div className="flex gap-1">
          <span className="text-zinc-500">Lower</span>
          <span className="text-emerald-400/70">
            {formatPrice(data.lower)}
          </span>
        </div>
      )}
      {data.volume !== undefined && (
        <div className="flex gap-1 ml-2">
          <span className="text-zinc-500">Vol</span>
          <span className="text-zinc-300">
            {data.volume?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </div>
  );
}
