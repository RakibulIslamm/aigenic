'use client';

import { format, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ConversationsChartProps {
  data: Array<{ date: string; conversations: number }>;
}

export function ConversationsChart({ data }: ConversationsChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 12, right: 12, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="conversationsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="oklch(0.85 0 0)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="oklch(0.85 0 0)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="oklch(1 0 0 / 8%)"
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          stroke="oklch(0.708 0 0)"
          fontSize={11}
          tickFormatter={(value: string) => format(parseISO(value), 'MMM d')}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis stroke="oklch(0.708 0 0)" fontSize={11} allowDecimals={false} width={32} />
        <Tooltip
          cursor={{ stroke: 'oklch(1 0 0 / 16%)', strokeWidth: 1 }}
          contentStyle={{
            background: 'oklch(0.205 0 0)',
            border: '1px solid oklch(1 0 0 / 10%)',
            borderRadius: 8,
            color: 'oklch(0.985 0 0)',
            fontSize: 12,
          }}
          labelFormatter={(value) =>
            typeof value === 'string' ? format(parseISO(value), 'PP') : ''
          }
          formatter={(value) => [`${value ?? 0}`, 'Conversations']}
        />
        <Area
          type="monotone"
          dataKey="conversations"
          stroke="oklch(0.985 0 0)"
          strokeWidth={1.5}
          fill="url(#conversationsFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
