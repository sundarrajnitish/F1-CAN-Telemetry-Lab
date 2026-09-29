function st = f1can_logger(st, id, data)
%F1CAN_LOGGER  Frame-by-frame receive state machine shared by the live and offline receivers.
%
%   st = f1can_logger()              initialise
%   st = f1can_logger(st, id, data)  feed one frame
%
%   st.logs is a struct array (one element per car) with numeric columns
%   [lap, lap_time_s, distance_m, speed_kph, rpm, gear, throttle_pct, brake, drs, x_m, y_m, z_m].
%   Cars are identified by the explicit F1_SessionCtrl / F1_LapContext driver numbers, never by
%   the position of a gap in the stream (the v1 approach mislabelled 8 of 20 cars).

    if nargin == 0
        st = struct('logs', struct('driver', {}, 'rows', {}), 'current', NaN, 'finished', false, ...
                    'ctx', [], 'pos', [], 'lastCounter', NaN, 'stats', ...
                    struct('frames', 0, 'samples', 0, 'crcErrors', 0, 'counterGaps', 0, 'unknown', 0), ...
                    'newRow', []);
        return
    end
    st.newRow = [];
    st.stats.frames = st.stats.frames + 1;
    [name, v, ok, err] = f1can_decode(id, data);
    if ~ok
        if ~isempty(strfind(err, 'CRC'))
            st.stats.crcErrors = st.stats.crcErrors + 1;
        else
            st.stats.unknown = st.stats.unknown + 1;
        end
        return
    end
    switch name
        case 'F1_SessionCtrl'
            switch v.Command
                case 1  % START_STREAM
                    st.current = v.DriverNumber;
                    st.lastCounter = NaN;
                case 2  % END_STREAM
                    st.current = NaN;
                case 3  % END_SESSION
                    st.finished = true;
            end
        case 'F1_LapContext'
            st.ctx = v;
        case 'F1_Position'
            st.pos = v;
        case 'F1_CarTelemetry'
            if ~isnan(st.lastCounter) && v.AliveCounter ~= mod(st.lastCounter + 1, 16)
                st.stats.counterGaps = st.stats.counterGaps + 1;
            end
            st.lastCounter = v.AliveCounter;
            if isempty(st.ctx), return, end
            p = st.pos;
            if isempty(p), p = struct('PosX', 0, 'PosY', 0, 'PosZ', 0); end
            row = [st.ctx.LapNumber, st.ctx.LapTime, st.ctx.LapDistance, v.Speed, v.RPM, v.Gear, ...
                   v.Throttle, v.Brake, v.DRS, p.PosX, p.PosY, p.PosZ];
            drv = st.ctx.DriverNumber;
            k = find([st.logs.driver] == drv, 1);
            if isempty(k)
                st.logs(end+1) = struct('driver', drv, 'rows', row);
            else
                st.logs(k).rows(end+1, :) = row;
            end
            st.newRow = [drv, row];
            st.stats.samples = st.stats.samples + 1;
    end
end
