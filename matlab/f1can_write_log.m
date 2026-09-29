function files = f1can_write_log(logs, outDir)
%F1CAN_WRITE_LOG  Save every car in a logger struct to driver_NN_telemetry.csv.
%   Same columns as the Python receiver, so python -m f1can compare works on MATLAB logs too.

    if nargin < 2, outDir = 'logs'; end
    if ~exist(outDir, 'dir'), mkdir(outDir); end
    header = 'driver,lap,lap_time_s,distance_m,speed_kph,rpm,gear,throttle_pct,brake,drs,x_m,y_m,z_m';
    files = {};
    for k = 1:numel(logs)
        f = fullfile(outDir, sprintf('driver_%02d_telemetry.csv', logs(k).driver));
        fid = fopen(f, 'w');
        fprintf(fid, '%s\n', header);
        r = logs(k).rows;
        for i = 1:size(r, 1)
            fprintf(fid, '%d,%d,%.3f,%g,%.1f,%d,%d,%d,%d,%d,%.1f,%.1f,%.1f\n', logs(k).driver, r(i, :));
        end
        fclose(fid);
        files{end+1} = f; %#ok<AGROW>
        fprintf('saved %s (%d samples)\n', f, size(r, 1));
    end
end
