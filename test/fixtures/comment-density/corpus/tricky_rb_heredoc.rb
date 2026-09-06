# Real comment
text = <<~HEREDOC
  # this is inside a heredoc, not a comment
  some content
  http://not.a.comment
HEREDOC

sql = <<~SQL
  -- SQL comment inside heredoc, not Ruby comment
  SELECT * FROM users
SQL

# Another real comment
x = 1
