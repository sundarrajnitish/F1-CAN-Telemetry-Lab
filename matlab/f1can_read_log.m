function T = f1can_read_log(file)
%F1CAN_READ_LOG  Read a telemetry CSV (receiver log or the bundled dataset) into a struct of columns.
%   Text columns (abbr, team) become cell arrays; everything else is double.
%   Works in MATLAB and GNU Octave (no table/datetime needed).

    fid = fopen(file, 'r');
    if fid < 0, error('f1can:read', 'cannot open %s', file); end
    header = strtrim(fgetl(fid));
    names = strsplit(header, ',');
    isText = ismember(names, {'abbr', 'team'});
    fmt = '';
    for k = 1:numel(names)
        if isText(k), fmt = [fmt '%s']; else, fmt = [fmt '%f']; end %#ok<AGROW>
    end
    C = textscan(fid, fmt, 'Delimiter', ',');
    fclose(fid);
    T = struct();
    for k = 1:numel(names)
        T.(matlab.lang.makeValidName(names{k})) = C{k};
    end
end
